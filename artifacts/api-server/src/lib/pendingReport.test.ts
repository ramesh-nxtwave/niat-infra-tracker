import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  assertProductionPendingSender,
  PendingReportError,
  PendingReportService,
  type PendingReportSnapshotStore,
  InMemoryPendingReportSnapshotStore,
  ResendPendingReportProvider,
  buildPendingCsv,
  buildPendingDataset,
  buildPendingHtml,
  buildPendingText,
  normalizePendingPreviewRequest,
  PENDING_REPORT_SNAPSHOT_VERSION,
  type PendingReportDataSource,
  type PendingReportMessage,
  type PendingReportProvider,
} from "./pendingReport";
import { createPendingReportRouter } from "../routes/reports";
import { signToken } from "./auth";

const now = new Date("2026-05-15T12:00:00.000Z");

const legacyGoldenDataset: Parameters<typeof buildPendingHtml>[0] = {
  generatedAt: "2026-05-15T12:00:00.000Z",
  scope: { kind: "all-active-universities", universityCount: 2 },
  recipients: ["legacy@example.test"],
  summary: { pendingItems: 1, blockers: 1, overdue: 1, universitiesWithoutChecklistData: 1 },
  universities: [{
    id: "golden-u",
    name: "Golden & University",
    checklistDataState: "available",
    counts: { pending: 1, blockers: 1, overdue: 1 },
    pendingItems: [{
      id: "golden-item", space: "All Classrooms", classroom: "C-101",
      category: "Electrical", item: "Power <outlets>", status: "Blocker",
      isBlocker: true, isOverdue: true, targetDate: "2026-05-01",
      targetDateSource: "target timeline", remarks: "Awaiting \"vendor\"",
    }],
  }, {
    id: "empty-u",
    name: "Empty University",
    checklistDataState: "missing",
    counts: { pending: 0, blockers: 0, overdue: 0 },
    pendingItems: [],
  }],
};

const dataSource: PendingReportDataSource = {
  async activeUniversities(universityIds) {
    const universities = [
      {
        id: "missing", name: "Missing Checklist University", targetDate: null, spaces: [],
      },
      {
        id: "empty", name: "No Pending University", targetDate: null,
        spaces: [{
          name: "Lab", spaceType: "lab",
          checklistStatuses: [{
            id: "done", currentStatus: "Done", remarks: null, targetTimeline: null,
            universityTimeline: null, isBlocker: false, checklistItem: { category: "Safety", name: "Fire extinguisher" },
          }],
        }],
      },
      {
        id: "pending", name: "Pending & <University>", targetDate: "2026-05-20",
        classrooms: [{ roomId: " c-101 " }],
        spaces: [{
          name: "C-101", spaceType: "overall_classroom",
          checklistStatuses: [
            {
              id: "normal", currentStatus: "In-Progress", remarks: "A \"quoted\", multi-line\nremark",
              targetTimeline: "2026-05-20", universityTimeline: null, isBlocker: false,
              checklistItem: { category: "Electrical", name: "Power <outlets>" },
            },
            {
              id: "formula", currentStatus: "Yet to start", remarks: "\t=HYPERLINK(\"https://unsafe\")",
              targetTimeline: null, universityTimeline: null, isBlocker: false,
              checklistItem: { category: "=Formula", name: "+Formula item" },
            },
            {
              id: "blocker", currentStatus: "Partially Done", remarks: "<vendor> pending",
              targetTimeline: null, universityTimeline: "2026-05-01", isBlocker: true,
              checklistItem: { category: "Network", name: "Router" },
            },
            {
              id: "na", currentStatus: "N/A", remarks: null, targetTimeline: null,
              universityTimeline: null, isBlocker: false, checklistItem: { category: "Other", name: "Ignore" },
            },
          ],
        }],
      },
      {
        id: "ignored-space", name: "Ignored Space University", targetDate: null,
        classrooms: [{ roomId: "Active C-1" }],
        spaces: [
          {
            name: "Unrecognised", spaceType: "warehouse",
            checklistStatuses: [{
              id: "unknown-space", currentStatus: "Blocker", remarks: "must not report", targetTimeline: null,
              universityTimeline: null, isBlocker: true, checklistItem: { category: "Other", name: "Ignored" },
            }],
          },
          {
            name: "Deleted C-2", spaceType: "overall_classroom",
            checklistStatuses: [{
              id: "unmatched-classroom", currentStatus: "Blocker", remarks: "must not report", targetTimeline: null,
              universityTimeline: null, isBlocker: true, checklistItem: { category: "Other", name: "Ignored" },
            }],
          },
        ],
      },
    ];
    return universityIds ? universities.filter(university => universityIds.includes(university.id)) : universities;
  },
};

test("pending dataset includes all active universities and truthfully distinguishes missing data", async () => {
  const dataset = buildPendingDataset(await dataSource.activeUniversities(), now);

  assert.deepEqual(dataset.universities.map(university => university.name), [
    "Ignored Space University", "Missing Checklist University", "No Pending University", "Pending & <University>",
  ]);
  assert.equal(dataset.universities[0].checklistDataState, "missing", "unrecognised and unmatched classroom spaces are excluded");
  assert.equal(dataset.universities[1].checklistDataState, "missing");
  assert.equal(dataset.universities[2].checklistDataState, "available");
  assert.equal(dataset.universities[2].pendingItems.length, 0);
  assert.deepEqual(dataset.universities[2].sectionDataStates, {
    classrooms: "missing", lab: "available", staff: "missing",
  });
  assert.deepEqual(dataset.universities[3].sectionDataStates, {
    classrooms: "available", lab: "missing", staff: "missing",
  });
  assert.equal(dataset.summary.pendingItems, 3);

  const pending = dataset.universities[3].pendingItems;
  assert.equal(pending[0].id, "blocker", "blockers sort ahead of other pending work");
  assert.equal(pending[0].status, "Blocker");
  assert.equal(pending[0].isOverdue, true);
  assert.equal(pending[1].id, "normal");
  assert.equal(pending[1].timeline, null, "cleared line-item timelines do not fall back to planning dates");
  assert.equal(pending[1].targetDate, null);
  assert.equal(pending[1].isOverdue, false);
  assert.equal(pending.some(item => item.id === "na"), false, "N/A is excluded");

  const csv = buildPendingCsv(dataset);
  assert.match(csv, /"A ""quoted"", multi-line\nremark"/);
  assert.match(csv, /Pending & <University>/);
  assert.match(csv, /'\+Formula item/);
  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /Checklist data missing; not described as complete/);
  assert.match(csv, /No pending work reported/);
  const html = buildPendingHtml(dataset);
  assert.match(html, /Pending &amp; &lt;University&gt;/);
  assert.match(html, /Power &lt;outlets&gt;/);
  assert.doesNotMatch(html, /<vendor> pending/);
  const text = buildPendingText(dataset);
  assert.match(text, /Checklist data is missing; this university is not described as complete/);
  assert.match(text, /No pending work reported/);
});

test("room-section selection validates, freezes, and limits totals and every current output", async () => {
  const mixedSource: PendingReportDataSource = {
    async activeUniversities(universityIds) {
      const university = {
        id: "mixed-sections", name: "Mixed Sections University", targetDate: null,
        classrooms: [{ roomId: "C-101" }],
        spaces: [
          {
            name: "C-101", spaceType: "overall_classroom",
            checklistStatuses: [{
              id: "cr-selection", currentStatus: "Blocker", remarks: "CR only",
              targetTimeline: null, universityTimeline: null, isBlocker: true,
              checklistItem: { category: "Electrical", name: "CR task" },
            }],
          },
          {
            name: "5.0 Lab", spaceType: "lab",
            checklistStatuses: [{
              id: "lab-selection", currentStatus: "In-Progress", remarks: "Lab only",
              targetTimeline: null, universityTimeline: null, isBlocker: false,
              checklistItem: { category: "Safety", name: "Lab task" },
            }],
          },
          {
            name: "Staff Room", spaceType: "staff_room",
            checklistStatuses: [{
              id: "staff-selection", currentStatus: "Yet to start", remarks: "Staff only",
              targetTimeline: null, universityTimeline: null, isBlocker: false,
              checklistItem: { category: "Furniture", name: "Staff task" },
            }],
          },
        ],
      };
      return universityIds ? (universityIds.includes(university.id) ? [university] : []) : [university];
    },
  };
  const service = new PendingReportService(
    mixedSource,
    { async recordAccepted() {} },
    undefined,
    () => now,
    new InMemoryPendingReportSnapshotStore(),
  );

  const expected = [
    { input: ["classrooms"], output: ["classrooms"], ids: ["cr-selection"] },
    { input: ["lab", "staff"], output: ["lab", "staff"], ids: ["lab-selection", "staff-selection"] },
    { input: ["staff", "classrooms", "lab"], output: ["classrooms", "lab", "staff"], ids: ["cr-selection", "lab-selection", "staff-selection"] },
  ];
  for (const selection of expected) {
    const preview = await service.createPreview("section-admin", "admin@example.test", {
      universityIds: ["mixed-sections"],
      sections: selection.input,
    });
    assert.deepEqual(preview.sections, selection.output);
    assert.deepEqual(preview.scope, {
      kind: "selected-universities", universityCount: 1, universityIds: ["mixed-sections"],
    });
    assert.deepEqual(preview.universities[0].pendingItems.map(item => item.id), selection.ids);
    assert.equal(preview.summary.pendingItems, selection.ids.length);
    assert.deepEqual(Object.keys(preview.universities[0].sectionDataStates || {}), selection.output);
    const outputs = [
      buildPendingHtml(preview),
      buildPendingText(preview),
      buildPendingCsv(preview),
    ];
    for (const output of outputs) {
      assert.match(output, /Mixed Sections University/);
      for (const group of selection.output) assert.match(output, group === "classrooms" ? /CR \(Classrooms\)/ : group === "lab" ? /Lab Room/ : /Staff Room/);
      for (const excludedId of ["cr-selection", "lab-selection", "staff-selection"].filter(id => !selection.ids.includes(id))) {
        assert.doesNotMatch(output, new RegExp(excludedId));
      }
    }
  }

  const defaultPreview = await service.createPreview("section-admin");
  const allPreview = await service.createPreview("section-admin", "", { sections: ["cr", "Lab Room", "Staff Room"] });
  assert.deepEqual(defaultPreview.sections, ["classrooms", "lab", "staff"]);
  assert.deepEqual(allPreview.sections, defaultPreview.sections);
  const reviewedMessages: PendingReportMessage[] = [];
  const reviewedService = new PendingReportService(
    mixedSource,
    { async recordAccepted() {} },
    () => ({
      mode: "demonstration" as const,
      message: "Mocked; no email is sent.",
      provider: { async send(message: PendingReportMessage) {
        reviewedMessages.push(message);
        return { id: "section-provider-id" };
      } },
    }),
    () => now,
    new InMemoryPendingReportSnapshotStore(),
  );
  const reviewed = await reviewedService.createPreview("section-admin", "", { sections: ["lab"] });
  await reviewedService.confirm({
    previewId: reviewed.previewId, confirmed: true, userId: "section-admin", userEmail: "admin@example.test",
  });
  assert.equal(reviewedMessages.length, 1);
  assert.match(reviewedMessages[0].html, /Lab Room/);
  assert.doesNotMatch(reviewedMessages[0].html, /CR \(Classrooms\)|Staff Room/);
  assert.doesNotMatch(reviewedMessages[0].csv, /CR \(Classrooms\)|Staff Room/);
  for (const invalid of [[], ["unknown"], ["classrooms", "lab", "staff", "other"]]) {
    await assert.rejects(
      () => service.createPreview("section-admin", "", { sections: invalid }),
      (error: unknown) => error instanceof PendingReportError && error.status === 400,
    );
  }
});

test("preview request accepts the canonical Daily Remarks section key used by the dialog", () => {
  const request = normalizePendingPreviewRequest({ sections: ["dailyRemarks"] });
  assert.deepEqual(request.sections, ["dailyRemarks"]);
});

test("priority and Daily Remarks are frozen into the reviewed report", () => {
  const dataset = buildPendingDataset([
    {
      id: "low-university",
      name: "Low Priority University",
      targetDate: null,
      priority: "LOW",
      isCritical: false,
      classrooms: [],
      spaces: [],
      updates: [{
        id: "remark-1",
        content: "Older electrical update",
        authorName: "Infra Team",
        createdAt: "2026-09-20T09:30:00.000Z",
      }, {
        id: "remark-2",
        content: "Electrical work completed",
        authorName: "Infra Team",
        createdAt: "2026-09-21T09:30:00.000Z",
      }],
    },
    {
      id: "critical-university",
      name: "Critical University",
      targetDate: null,
      priority: "MEDIUM",
      isCritical: true,
      classrooms: [],
      spaces: [],
      updates: [],
    },
  ], new Date("2026-09-21T10:00:00.000Z"), {
    sections: ["classrooms", "dailyRemarks"],
    priority: "LOW",
  });

  assert.equal(dataset.priority?.label, "Low Priority");
  assert.deepEqual(dataset.sections, ["classrooms", "dailyRemarks"]);
  assert.deepEqual(dataset.universities.map(university => university.id), ["low-university"]);
  assert.equal(dataset.universities[0].dailyRemarks?.[0].content, "Electrical work completed");
  assert.equal(dataset.universities[0].dailyRemarks?.length, 1);
  assert.match(buildPendingHtml(dataset), /Low Priority/);
  assert.match(buildPendingHtml(dataset), /Electrical work completed/);
  assert.doesNotMatch(buildPendingHtml(dataset), /Older electrical update/);
  assert.match(buildPendingText(dataset), /Priority: Low Priority/);
  assert.doesNotMatch(buildPendingText(dataset), /Older electrical update/);
  assert.ok(buildPendingHtml(dataset).indexOf("Daily Remarks") < buildPendingHtml(dataset).indexOf("CR (Classrooms)"));
});

test("section availability does not let one populated space mask empty or unbacked active classrooms", () => {
  const dataset = buildPendingDataset([{
    id: "partial-sections",
    name: "Partial Sections University",
    targetDate: null,
    classrooms: [{ roomId: "C-101" }, { roomId: "C-102" }],
    spaces: [
      {
        name: "C-101", spaceType: "overall_classroom",
        checklistStatuses: [{
          id: "classroom-pending", currentStatus: "In Progress", remarks: "Needs follow-up",
          targetTimeline: null, universityTimeline: null, isBlocker: false,
          checklistItem: { category: "Electrical", name: "Power" },
        }],
      },
      { name: "C-102", spaceType: "overall_classroom", checklistStatuses: [] },
      {
        name: "5.0 Lab", spaceType: "lab",
        checklistStatuses: [{
          id: "lab-done", currentStatus: "DONE", remarks: null,
          targetTimeline: null, universityTimeline: null, isBlocker: false,
          checklistItem: { category: "Safety", name: "Extinguisher" },
        }],
      },
    ],
  }], now);
  const university = dataset.universities[0];

  assert.deepEqual(university.sectionDataStates, {
    classrooms: "missing", lab: "available", staff: "missing",
  });
  const html = buildPendingHtml(dataset);
  assert.match(html, /Checklist data missing\.<\/strong> This section is not described as complete\./);
  assert.match(buildPendingText(dataset), /CR \(Classrooms\) \(1 pending item\)\n  Checklist data is missing for this section; it is not described as complete\.\n/);

  const noModelDataset = buildPendingDataset([{
    id: "no-model",
    name: "No Model University",
    targetDate: null,
    classrooms: [{ roomId: "C-201" }],
    spaces: [{
      name: "C-201", spaceType: "overall_classroom",
      checklistStatuses: [{
        id: "classroom-done", currentStatus: "Done", remarks: null,
        targetTimeline: null, universityTimeline: null, isBlocker: false,
        checklistItem: { category: "Electrical", name: "Power" },
      }],
    }],
  }], now);
  assert.equal(noModelDataset.universities[0].sectionDataStates?.classrooms, "available");
});

test("v4 CSV retains pending rows and adds explicit missing section state rows", () => {
  const dataset = buildPendingDataset([{
    id: "csv-sections",
    name: "CSV Sections University",
    targetDate: null,
    classrooms: [{ roomId: "C-101" }],
    spaces: [{
      name: "5.0 Lab", spaceType: "lab",
      checklistStatuses: [{
        id: "lab-done", currentStatus: "Done", remarks: null,
        targetTimeline: null, universityTimeline: null, isBlocker: false,
        checklistItem: { category: "Safety", name: "Extinguisher" },
      }],
    }],
  }], now);
  const csv = buildPendingCsv(dataset, 4);
  const rows = csv.split("\r\n");

  assert.match(rows[0], /Room group,Section data/);
  assert.equal(rows.length, 4, "base state plus classrooms and staff missing-section rows");
  assert.match(csv, /CSV Sections University,No pending work reported,available,,,,/);
  assert.match(csv, /CSV Sections University,Checklist data missing; not described as complete,available,classrooms,missing/);
  assert.match(csv, /CSV Sections University,Checklist data missing; not described as complete,available,staff,missing/);
  assert.equal(dataset.universities[0].pendingItems.length, 0);
});

test("new pending renderer groups mixed rooms, preserves identities, and uses truthful section states", () => {
  const mixed = buildPendingDataset([{
    id: "mixed",
    name: "Mixed <University>",
    targetDate: null,
    classrooms: [{ roomId: " Room 204 " }],
    spaces: [
      {
        name: "Model Classroom",
        spaceType: "model_classroom",
        checklistStatuses: [{
          id: "model-item", currentStatus: " PARTIALLY__DONE ", remarks: "Model notes",
          targetTimeline: null, universityTimeline: "2026-05-20", isBlocker: false,
          checklistItem: { category: "Furniture", name: "Teacher desk" },
        }],
      },
      {
        name: "Room 204",
        spaceType: "overall_classroom",
        checklistStatuses: [{
          id: "classroom-item", currentStatus: " in--progress ", remarks: "Long classroom remark",
          targetTimeline: null, universityTimeline: "2026-05-01", isBlocker: false,
          checklistItem: { category: "Electrical", name: "Power <outlets>" },
        }],
      },
      {
        name: "5.0 Lab",
        spaceType: "lab",
        checklistStatuses: [{
          id: "lab-item", currentStatus: " YET_to--START ", remarks: null,
          targetTimeline: null, universityTimeline: "2026-05-21", isBlocker: false,
          checklistItem: { category: "Safety", name: "Fire extinguisher" },
        }],
      },
      {
        name: "Staff Room",
        spaceType: "staff_room",
        checklistStatuses: [{
          id: "staff-item", currentStatus: "  BLOCKER  ", remarks: "Blocked by <vendor>",
          targetTimeline: null, universityTimeline: null, isBlocker: true,
          checklistItem: { category: "Network", name: "Router" },
        }, {
          id: "staff-other", currentStatus: " waiting  status ", remarks: null,
          targetTimeline: null, universityTimeline: null, isBlocker: false,
          checklistItem: { category: "Furniture", name: "Notice board" },
        }],
      },
    ],
  }], now).universities[0];

  assert.deepEqual(mixed.sectionDataStates, {
    classrooms: "available", lab: "available", staff: "available",
  });
  assert.deepEqual(
    mixed.pendingItems.map(item => ({ id: item.id, roomGroup: item.roomGroup, classroom: item.classroom })),
    [
      { id: "classroom-item", roomGroup: "classrooms", classroom: "All classrooms (1)" },
      { id: "model-item", roomGroup: "classrooms", classroom: null },
      { id: "lab-item", roomGroup: "lab", classroom: null },
      { id: "staff-item", roomGroup: "staff", classroom: null },
      { id: "staff-other", roomGroup: "staff", classroom: null },
    ],
  );
  assert.deepEqual(
    Object.fromEntries(mixed.pendingItems.map(item => [item.id, item.status])),
    {
      "staff-item": "Blocker",
      "classroom-item": "In-Progress",
      "model-item": "Partially Done",
      "lab-item": "Yet to start",
      "staff-other": "waiting status",
    },
  );

  const dataset = buildPendingDataset([{
    id: "mixed",
    name: "Mixed <University>",
    targetDate: null,
    classrooms: [{ roomId: " Room 204 " }],
    spaces: [
      {
        name: "Model Classroom", spaceType: "model_classroom",
        checklistStatuses: [{
          id: "model-item", currentStatus: " PARTIALLY__DONE ", remarks: "Model notes",
          targetTimeline: null, universityTimeline: "2026-05-20", isBlocker: false,
          checklistItem: { category: "Furniture", name: "Teacher desk" },
        }],
      },
      {
        name: "Room 204", spaceType: "overall_classroom",
        checklistStatuses: [{
          id: "classroom-item", currentStatus: " in--progress ", remarks: "Long classroom remark",
          targetTimeline: null, universityTimeline: "2026-05-01", isBlocker: false,
          photoUrl: "/objects/uploads/classroom-evidence",
          photoContentType: "image/jpeg",
          updatedAt: "2026-05-14T08:00:00.000Z",
          checklistItem: { category: "Electrical", name: "Power <outlets>" },
        }],
      },
      {
        name: "5.0 Lab", spaceType: "lab",
        checklistStatuses: [{
          id: "lab-item", currentStatus: " YET_to--START ", remarks: null,
          targetTimeline: null, universityTimeline: "2026-05-21", isBlocker: false,
          checklistItem: { category: "Safety", name: "Fire extinguisher" },
        }],
      },
      {
        name: "Staff Room", spaceType: "staff_room",
        checklistStatuses: [{
          id: "staff-item", currentStatus: "  BLOCKER  ", remarks: "Blocked by <vendor>",
          targetTimeline: null, universityTimeline: null, isBlocker: true,
          checklistItem: { category: "Network", name: "Router" },
        }, {
          id: "staff-other", currentStatus: " waiting  status ", remarks: null,
          targetTimeline: null, universityTimeline: null, isBlocker: false,
          checklistItem: { category: "Furniture", name: "Notice board" },
        }],
      },
    ],
  }], now);
  const html = buildPendingHtml(dataset);
  const text = buildPendingText(dataset);

  assert.equal(PENDING_REPORT_SNAPSHOT_VERSION, 7);
  assert.doesNotMatch(html, /<style\b/i, "new email CSS must survive stripped-style clients");
  assert.match(html, />CR \(Classrooms\)</);
  assert.match(html, />Lab Room</);
  assert.match(html, />Staff Room</);
  assert.match(html, /Model Classroom/);
  assert.match(html, /background:#fef2f2;color:#b91c1c/);
  assert.match(html, /background:#eff6ff;color:#1d4ed8/);
  assert.match(html, /background:#f5f3ff;color:#6d28d9/);
  assert.match(html, /background:#fffbeb;color:#92400e/);
  assert.match(html, /pending-status-other/);
  assert.match(html, /WARNING: OVERDUE/);
  assert.match(html, /May 15, 2026, 12:00 UTC/);
  assert.match(html, /May 1, 2026/);
  assert.match(html, /Power &lt;outlets&gt;/);
  assert.doesNotMatch(html, /Blocked by <vendor>/);
  assert.match(
    html,
    /href="https:\/\/niatinfratracker\.replit\.app\/university\/mixed\?item=[^"]+"/,
  );
  assert.doesNotMatch(html, /href="\/university\//);
  assert.match(text, /Generated: May 15, 2026, 12:00 UTC/);
  assert.match(text, /Classrooms/);
  assert.match(text, /Lab Room/);
  assert.match(text, /Staff Room/);
  assert.match(text, /WARNING: OVERDUE/);
  assert.match(text, /Timeline: Not provided/);
});

test("v5 dashboard grouping counts each Model + All Classrooms line once", () => {
  const roomIds = ["C-101", "C-102", "C-103"];
  const classrooms = roomIds.map(roomId => ({
    name: roomId,
    spaceType: "overall_classroom",
    checklistStatuses: Array.from({ length: 4 }, (_, index) => ({
      id: `${roomId}-${index}`,
      currentStatus: index === 0 ? "Blocker" : "In-Progress",
      remarks: `Room ${roomId} remark`,
      targetTimeline: null,
      universityTimeline: "2026-05-20",
      isBlocker: index === 0,
      checklistItem: { category: "Electrical", name: `CR line ${index}` },
    })),
  }));
  const lab = {
    name: "5.0 Lab",
    spaceType: "lab",
    checklistStatuses: Array.from({ length: 8 }, (_, index) => ({
      id: `lab-${index}`,
      currentStatus: "Yet to start",
      remarks: null,
      targetTimeline: null,
      universityTimeline: "2026-05-25",
      isBlocker: false,
      checklistItem: { category: "Lab", name: `Lab line ${index}` },
    })),
  };
  const model = {
    name: "Model Classroom",
    spaceType: "model_classroom",
    checklistStatuses: Array.from({ length: 4 }, (_, index) => ({
      id: `model-${index}`,
      currentStatus: index === 0 ? "In-Progress" : "Partially Done",
      remarks: `Model preferred remark ${index}`,
      targetTimeline: null,
      universityTimeline: "2026-05-30",
      isBlocker: false,
      checklistItem: { category: "Electrical", name: `CR line ${index}` },
    })),
  };

  const dataset = buildPendingDataset([{
    id: "amet",
    name: "AMET",
    targetDate: null,
    classrooms: roomIds.map(roomId => ({ roomId })),
    spaces: [model, ...classrooms, lab],
  }], now);
  const university = dataset.universities[0];

  assert.equal(dataset.summary.pendingItems, 12, "four grouped CR rows plus eight lab rows");
  assert.equal(university.counts.pending, 12);
  assert.equal(university.pendingItems.filter(item => item.roomGroup === "classrooms").length, 4);
  assert.equal(university.pendingItems.filter(item => item.roomGroup === "lab").length, 8);
  const firstCr = university.pendingItems.find(item => item.item === "CR line 0")!;
  assert.equal(firstCr.areaLabel, "Model + All Classrooms (3)");
  assert.equal(firstCr.status, "Blocker", "group priority promotes a blocker");
  assert.equal(firstCr.timeline, "2026-05-30");
  assert.equal(firstCr.remark, "Model preferred remark 0");
  assert.equal(firstCr.sources?.length, 4, "all source status identities remain available");
});

test("v6 outputs use the seven dashboard columns, include authorized evidence links and remark dates", () => {
  const dataset = buildPendingDataset([{
    id: "evidence-university",
    name: "Evidence University",
    targetDate: null,
    classrooms: [{ roomId: "C-101" }],
    spaces: [{
      name: "C-101",
      spaceType: "overall_classroom",
      checklistStatuses: [{
        id: "status-evidence",
        currentStatus: "In-Progress",
        remarks: "Current remark",
        targetTimeline: "2026-05-20",
        universityTimeline: null,
        isBlocker: false,
        updatedAt: new Date("2026-05-15T10:00:00.000Z"),
        photoUrl: "/objects/uploads/public-looking-path",
        photoContentType: "image/jpeg",
        history: [{
          remarks: "Current remark",
          changedAt: new Date("2026-05-14T10:00:00.000Z"),
        }],
        photoHistory: [{
          id: "photo-history-1",
          photoUrl: "/objects/uploads/public-looking-path",
          contentType: "image/jpeg",
          uploadedAt: new Date("2026-05-13T10:00:00.000Z"),
        }],
        checklistItem: { category: "Hidden category", name: "Evidence line" },
      }],
    }],
  }], now);
  const html = buildPendingHtml(dataset);
  const text = buildPendingText(dataset);
  const csv = buildPendingCsv(dataset);

  for (const output of [html, text, csv]) {
    assert.doesNotMatch(output, /Category/, "new output does not add a Category column");
  }
  for (const column of ["Location", "Line Item", "Status", "Timeline", "Line Item Remark", "Remark Date", "Attachment"]) {
    assert.match(html, new RegExp(`>${column}<`));
    assert.match(csv, new RegExp(column));
  }
  assert.doesNotMatch(html, /Open CR \(Classrooms\)/);
  assert.match(html, /<strong>Evidence line<\/strong>/);
  assert.doesNotMatch(html, /href="\/objects\//, "email never exposes a raw public object link");
  assert.match(html, /May 13, 2026/);
  assert.match(html, /May 14, 2026/);
  assert.match(text, /Remark Date: May 14, 2026/);
  assert.match(csv, /CR \(Classrooms\)/);
});

test("v6 grouped remarks omit empty classroom notes, deduplicate repeats, and align dates", () => {
  const dataset = buildPendingDataset([{
    id: "remark-group",
    name: "Remark Group University",
    targetDate: null,
    classrooms: [{ roomId: "C-101" }, { roomId: "C-102" }, { roomId: "C-103" }],
    spaces: [
      {
        name: "Model Classroom",
        spaceType: "model_classroom",
        checklistStatuses: [{
          id: "model-remark", currentStatus: "In-Progress", remarks: null,
          targetTimeline: null, universityTimeline: null, isBlocker: false,
          checklistItem: { category: "Electrical", name: "Grouped power" },
        }],
      },
      ...["C-101", "C-102", "C-103"].map((name, index) => ({
        name, spaceType: "overall_classroom",
        checklistStatuses: [{
          id: `room-${index}`, currentStatus: "In-Progress",
          remarks: index === 1 ? "Shared room note" : "",
          remarkDate: new Date(`2026-05-0${index + 1}T12:00:00.000Z`),
          targetTimeline: null, universityTimeline: null, isBlocker: false,
          checklistItem: { category: "Electrical", name: "Grouped power" },
        }],
      })),
    ],
  }], now);
  const item = dataset.universities[0].pendingItems[0];
  assert.equal(item.areaLabel, "Model + All Classrooms (3)");
  const actualRemarkSources: Array<[string, string | null]> = item.remarkSources
    ?.map(source => [source.label, source.remark] as [string, string | null]) || [];
  actualRemarkSources.sort((left, right) => left[0].localeCompare(right[0]));
  const expectedRemarkSources: Array<[string, string | null]> = [
    ["Model Classroom", null],
    ["All Classrooms — C-101", null],
    ["All Classrooms — C-102", "Shared room note"],
    ["All Classrooms — C-103", null],
  ];
  expectedRemarkSources.sort((left, right) => left[0].localeCompare(right[0]));
  assert.deepEqual(actualRemarkSources, expectedRemarkSources);
  assert.match(buildPendingText(dataset), /Line Item Remark: Shared room note/);
  assert.match(buildPendingText(dataset), /Remark Date: May 2, 2026/);
  assert.doesNotMatch(buildPendingText(dataset), /May 1, 2026|May 3, 2026/);
  assert.match(buildPendingHtml(dataset), />Shared room note</);
  assert.match(buildPendingCsv(dataset), /Shared room note/);

  const repeated = buildPendingDataset([{
    id: "repeated-remark-group",
    name: "Repeated Remark University",
    targetDate: null,
    classrooms: [{ roomId: "C-201" }, { roomId: "C-202" }],
    spaces: [{
      name: "Model Classroom", spaceType: "model_classroom",
      checklistStatuses: [{
        id: "repeated-model", currentStatus: "In-Progress", remarks: null,
        targetTimeline: null, universityTimeline: null, isBlocker: false,
        checklistItem: { category: "Electrical", name: "Repeated power" },
      }],
    }, {
      name: "C-201", spaceType: "overall_classroom",
      checklistStatuses: [{
        id: "repeated-a", currentStatus: "In-Progress", remarks: "Same note",
        targetTimeline: null, universityTimeline: null, isBlocker: false,
        checklistItem: { category: "Electrical", name: "Repeated power" },
      }],
    }, {
      name: "C-202", spaceType: "overall_classroom",
      checklistStatuses: [{
        id: "repeated-b", currentStatus: "In-Progress", remarks: "Same note",
        targetTimeline: null, universityTimeline: null, isBlocker: false,
        checklistItem: { category: "Electrical", name: "Repeated power" },
      }],
    }],
  }], now);
  const repeatedText = buildPendingText(repeated);
  assert.equal((repeatedText.match(/Line Item Remark: Same note/g) || []).length, 1);

  const distinct = buildPendingDataset([{
    id: "distinct-remark-group",
    name: "Distinct Remark University",
    targetDate: null,
    classrooms: [{ roomId: "C-301" }, { roomId: "C-302" }],
    spaces: [{
      name: "Model Classroom", spaceType: "model_classroom",
      checklistStatuses: [{
        id: "distinct-model", currentStatus: "In-Progress", remarks: null,
        targetTimeline: null, universityTimeline: null, isBlocker: false,
        checklistItem: { category: "Electrical", name: "Distinct power" },
      }],
    }, {
      name: "C-301", spaceType: "overall_classroom",
      checklistStatuses: [{
        id: "distinct-a", currentStatus: "In-Progress", remarks: "First note",
        targetTimeline: null, universityTimeline: null, isBlocker: false,
        checklistItem: { category: "Electrical", name: "Distinct power" },
      }],
    }, {
      name: "C-302", spaceType: "overall_classroom",
      checklistStatuses: [{
        id: "distinct-b", currentStatus: "In-Progress", remarks: "Second note",
        targetTimeline: null, universityTimeline: null, isBlocker: false,
        checklistItem: { category: "Electrical", name: "Distinct power" },
      }],
    }],
  }], now);
  const distinctText = buildPendingText(distinct);
  assert.match(distinctText, /All Classrooms — C-301: First note/);
  assert.match(distinctText, /All Classrooms — C-302: Second note/);

  const empty = buildPendingDataset([{
    id: "empty-remark-group",
    name: "Empty Remark University",
    targetDate: null,
    classrooms: [{ roomId: "C-401" }, { roomId: "C-402" }],
    spaces: [{
      name: "C-401", spaceType: "overall_classroom",
      checklistStatuses: [{
        id: "empty-a", currentStatus: "In-Progress", remarks: "",
        targetTimeline: null, universityTimeline: null, isBlocker: false,
        checklistItem: { category: "Electrical", name: "Empty power" },
      }],
    }, {
      name: "C-402", spaceType: "overall_classroom",
      checklistStatuses: [{
        id: "empty-b", currentStatus: "In-Progress", remarks: null,
        targetTimeline: null, universityTimeline: null, isBlocker: false,
        checklistItem: { category: "Electrical", name: "Empty power" },
      }],
    }],
  }], now);
  const emptyText = buildPendingText(empty);
  assert.match(emptyText, /Line Item Remark: —/);
  assert.match(emptyText, /Remark Date: —/);
});

test("rendering an older snapshot version keeps the flattened legacy contract", () => {
  const dataset = buildPendingDataset([{
    id: "legacy-render",
    name: "Legacy University",
    targetDate: null,
    spaces: [{
      name: "Lab", spaceType: "lab",
      checklistStatuses: [{
        id: "legacy-item", currentStatus: "In-Progress", remarks: null,
        targetTimeline: null, universityTimeline: null, isBlocker: false,
        checklistItem: { category: "Legacy", name: "Legacy task" },
      }],
    }],
  }], now);
  const legacyHtml = buildPendingHtml(dataset, 1);
  const legacyV2Html = buildPendingHtml(dataset, 2);
  const legacyText = buildPendingText(dataset, 3);
  const modernHtml = buildPendingHtml(dataset, 4);

  assert.match(legacyHtml, /<style>/);
  assert.match(legacyV2Html, /<style>/);
  assert.doesNotMatch(legacyHtml, />Classrooms</);
  assert.match(legacyHtml, /Generated: 2026-05-15T12:00:00.000Z/);
  assert.match(legacyText, /Generated: 2026-05-15T12:00:00.000Z/);
  assert.doesNotMatch(legacyText, /Lab Room/);
  assert.doesNotMatch(modernHtml, /<style>/);
  assert.match(modernHtml, />Lab Room</);
});

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("legacy v1-v3 renderers match the persisted HEAD golden bytes", () => {
  const expected = {
    html: "f8dd6a1498340d3d33fb4da4d133b754822356b90ccfa28a6ff0288775773d27",
    text: "f32577ce695538199c7f3f918e39d23498f0adaf9bc59f8a274dfb7c322254ef",
    csv: "f573593eb18e320b4094f0f3f52f2f759bb05e04f7b8959fb602c1ed77ddcb7f",
  };
  for (const version of [1, 2, 3]) {
    assert.equal(sha256(buildPendingHtml(legacyGoldenDataset, version)), expected.html);
    assert.equal(sha256(buildPendingText(legacyGoldenDataset, version)), expected.text);
    assert.equal(sha256(buildPendingCsv(legacyGoldenDataset, version)), expected.csv);
  }
});

test("persisted v2 and v3 snapshots send with recomputed legacy hashes and bytes", async () => {
  const store = new InMemoryPendingReportSnapshotStore();
  const messages: PendingReportMessage[] = [];
  const provider: PendingReportProvider = {
    async send(message) {
      messages.push(message);
      return { id: `legacy-${messages.length}` };
    },
  };
  const filename = "pending-work-report-2026-05-15.csv";
  const base = {
    createdByUserId: "legacy-admin",
    createdByEmail: "legacy-admin@example.test",
    deliveryMode: "demonstration" as const,
    dataset: legacyGoldenDataset,
    filename,
    idempotencyExpiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
    state: "ready" as const,
    leaseToken: null,
    leaseExpiresAt: null,
    attemptedAt: null,
    attemptCount: 0,
    providerId: null,
    providerAcceptedAt: null,
    auditRecorded: null,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1_000),
  };
  await store.create({
    ...base,
    id: "legacy-v2-golden",
    snapshotVersion: 2,
    snapshotHash: "c391c0f8b40ffcfed1aca47d61a67934d36900bb524d457c70eb313ee926739b",
    idempotencyKey: "legacy-v2-key",
  });
  await store.create({
    ...base,
    id: "legacy-v3-golden",
    snapshotVersion: 3,
    deliveryProvider: "demonstration",
    senderEmail: null,
    senderName: null,
    snapshotHash: "3df2e92f608210f9802f673e5fb29106bdf982fc67c775fbf7dbdddb0dc659e1",
    idempotencyKey: "legacy-v3-key",
  });
  const service = new PendingReportService(
    { async activeUniversities() { return []; } },
    { async recordAccepted() {} },
    () => ({ mode: "demonstration" as const, message: "Mocked; no email is sent.", provider }),
    () => now,
    store,
  );

  for (const previewId of ["legacy-v2-golden", "legacy-v3-golden"]) {
    await service.confirm({
      previewId, confirmed: true, userId: "legacy-admin", userEmail: "legacy-admin@example.test",
    });
  }
  assert.equal(messages.length, 2);
  for (const message of messages) {
    assert.equal(sha256(message.html), "f8dd6a1498340d3d33fb4da4d133b754822356b90ccfa28a6ff0288775773d27");
    assert.equal(sha256(message.text), "f32577ce695538199c7f3f918e39d23498f0adaf9bc59f8a274dfb7c322254ef");
    assert.equal(sha256(message.csv), "f573593eb18e320b4094f0f3f52f2f759bb05e04f7b8959fb602c1ed77ddcb7f");
  }
});

test("confirmation sends the frozen snapshot exactly once across concurrent retries", async () => {
  let providerCalls = 0;
  let sentSubject = "";
  let sentCsv = "";
  const provider: PendingReportProvider = {
    async send(message) {
      providerCalls++;
      sentSubject = message.subject;
      sentCsv = message.csv;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { id: "mock-provider-id" };
    },
  };
  const service = new PendingReportService(
    dataSource,
    { async recordAccepted() {} },
    () => ({ mode: "demonstration" as const, message: "Mocked; no email is sent.", provider }),
    () => now,
    new InMemoryPendingReportSnapshotStore(),
  );

  const preview = await service.createPreview("admin-1");
  assert.deepEqual(preview.recipients, [
    "karthik@nxtwave.tech", "Varshith@nxtwave.tech", "satish.jada@nxtwave.co.in",
    "srinivas.vatturi@nxtwave.tech", "ramesh@nxtwave.co.in",
  ]);
  assert.equal(preview.delivery.mode, "demonstration");
  const [first, second] = await Promise.all([
    service.confirm({ previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test" }),
    service.confirm({ previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test" }),
  ]);
  assert.equal(providerCalls, 1);
  assert.deepEqual(first, second);
  assert.equal(first.accepted, true);
  assert.equal(first.providerId, "mock-provider-id");
  assert.match(first.message, /Inbox delivery is not confirmed/);
  assert.match(sentSubject, /Pending Work Report/);
  assert.match(sentCsv, /Power <outlets>/);

  await assert.rejects(
    () => service.confirm({ previewId: preview.previewId, confirmed: true, userId: "admin-2", userEmail: "other@example.test" }),
    (error: unknown) => error instanceof PendingReportError && error.status === 403,
  );
});

test("an audit failure does not turn provider acceptance into a failed send", async () => {
  const provider: PendingReportProvider = { async send() { return { id: "accepted-before-audit" }; } };
  const service = new PendingReportService(
    dataSource,
    { async recordAccepted() { throw new Error("audit database unavailable"); } },
    () => ({ mode: "demonstration" as const, message: "Mocked; no email is sent.", provider }),
    () => now,
    new InMemoryPendingReportSnapshotStore(),
  );
  const preview = await service.createPreview("admin-1");
  const result = await service.confirm({
    previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test",
  });
  assert.equal(result.accepted, true);
  assert.equal(result.providerId, "accepted-before-audit");
  assert.equal(result.auditRecorded, false);
});

test("confirmation rejects unreviewed or foreign snapshots without calling a provider", async () => {
  let providerCalls = 0;
  const provider: PendingReportProvider = { async send() { providerCalls++; return { id: "unexpected" }; } };
  const service = new PendingReportService(
    dataSource,
    { async recordAccepted() {} },
    () => ({ mode: "demonstration" as const, message: "Mocked; no email is sent.", provider }),
    () => now,
    new InMemoryPendingReportSnapshotStore(),
  );
  const preview = await service.createPreview("admin-1");
  await assert.rejects(
    () => service.confirm({ previewId: preview.previewId, confirmed: false, userId: "admin-1", userEmail: "admin@example.test" }),
    (error: unknown) => error instanceof PendingReportError && error.status === 400,
  );
  await assert.rejects(
    () => service.confirm({ previewId: preview.previewId, confirmed: true, userId: "admin-2", userEmail: "admin@example.test" }),
    (error: unknown) => error instanceof PendingReportError && error.status === 403,
  );
  assert.equal(providerCalls, 0);
});

test("version 2 preview freezes validated selected scope and editable recipients", async () => {
  const store = new InMemoryPendingReportSnapshotStore();
  let sentRecipients: readonly string[] = [];
  let auditedScope: unknown;
  const provider: PendingReportProvider = {
    async send(message) { sentRecipients = message.recipients; return { id: "selected-provider-id" }; },
  };
  const service = new PendingReportService(
    dataSource,
    { async recordAccepted(input) { auditedScope = input.scope; } },
    () => ({ mode: "demonstration" as const, message: "Mocked; no email is sent.", provider }),
    () => now,
    store,
  );
  const preview = await service.createPreview("admin-1", "admin@example.test", {
    recipients: [" lead@example.edu ", "LEAD@example.edu", "ops@example.edu"],
    universityIds: ["pending", "empty"],
  });
  assert.deepEqual(preview.recipients, ["lead@example.edu", "ops@example.edu"]);
  assert.deepEqual(normalizePendingPreviewRequest({}).recipients, [
    "karthik@nxtwave.tech", "Varshith@nxtwave.tech", "satish.jada@nxtwave.co.in",
    "srinivas.vatturi@nxtwave.tech", "ramesh@nxtwave.co.in",
  ], "an object without recipients uses the manual defaults");
  assert.deepEqual(preview.scope, {
    kind: "selected-universities", universityCount: 2, universityIds: ["empty", "pending"],
  });
  assert.deepEqual(preview.universities.map(university => university.id), ["empty", "pending"]);
  await service.confirm({
    previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test",
  });
  assert.deepEqual(sentRecipients, ["lead@example.edu", "ops@example.edu"]);
  assert.deepEqual(auditedScope, preview.scope);

  await assert.rejects(
    () => service.createPreview("admin-1", "admin@example.test", { recipients: [], universityIds: ["pending"] }),
    (error: unknown) => error instanceof PendingReportError && error.status === 400,
  );
  await assert.rejects(
    () => service.createPreview("admin-1", "admin@example.test", { recipients: ["bad@example.edu\r\nBcc:evil@example.edu"], universityIds: ["pending"] }),
    (error: unknown) => error instanceof PendingReportError && error.status === 400,
  );
  await assert.rejects(
    () => service.createPreview("admin-1", "admin@example.test", { recipients: ["lead@example.edu"], universityIds: [] }),
    (error: unknown) => error instanceof PendingReportError && error.status === 400,
  );
  await assert.rejects(
    () => service.createPreview("admin-1", "admin@example.test", { recipients: ["lead@example.edu"], universityIds: ["missing-id"] }),
    (error: unknown) => error instanceof PendingReportError && error.status === 400,
  );
});

test("a shared durable snapshot recovers an unknown outcome after restart using the identical stable provider key", async () => {
  const store = new InMemoryPendingReportSnapshotStore();
  let firstAttempt = true;
  const messages: Array<{ idempotencyKey: string; csv: string; html: string; text: string }> = [];
  const provider: PendingReportProvider = {
    async send(message) {
      messages.push({
        idempotencyKey: message.idempotencyKey, csv: message.csv, html: message.html, text: message.text,
      });
      if (firstAttempt) throw new PendingReportError(504, "Resend did not respond within 10 seconds. No delivery outcome is known; retry the same confirmation.");
      return { id: "recovered-provider-id" };
    },
  };
  const delivery = () => ({ mode: "demonstration" as const, message: "Mocked; no email is sent.", provider });
  const firstService = new PendingReportService(dataSource, { async recordAccepted() {} }, delivery, () => now, store);
  const preview = await firstService.createPreview("admin-1");
  await assert.rejects(
    () => firstService.confirm({ previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test" }),
    (error: unknown) => error instanceof PendingReportError && error.status === 504,
  );

  // A new service instance represents another process after restart. It sees
  // the same durable unknown record, not a process-local cache.
  firstAttempt = false;
  const restartedService = new PendingReportService(dataSource, { async recordAccepted() {} }, delivery, () => now, store);
  const recovered = await restartedService.confirm({
    previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test",
  });
  assert.equal(recovered.providerId, "recovered-provider-id");
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[1], messages[0], "recovery derives the exact reviewed payload from the stored structured snapshot");

  const anotherProcess = new PendingReportService(dataSource, { async recordAccepted() {} }, delivery, () => now, store);
  const acceptedAgain = await anotherProcess.confirm({
    previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test",
  });
  assert.equal(acceptedAgain.providerId, "recovered-provider-id");
  assert.equal(messages.length, 2, "accepted outcome is shared and does not submit again");
});

test("unknown sends past the provider idempotency window refuse unsafe regeneration", async () => {
  const store = new InMemoryPendingReportSnapshotStore();
  let current = new Date(now);
  let providerCalls = 0;
  const provider: PendingReportProvider = {
    async send() {
      providerCalls++;
      throw new PendingReportError(504, "Resend did not respond within 10 seconds. No delivery outcome is known; retry the same confirmation.");
    },
  };
  const delivery = () => ({ mode: "demonstration" as const, message: "Mocked; no email is sent.", provider });
  const service = new PendingReportService(dataSource, { async recordAccepted() {} }, delivery, () => current, store);
  const preview = await service.createPreview("admin-1");
  await assert.rejects(() => service.confirm({
    previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test",
  }), (error: unknown) => error instanceof PendingReportError && error.status === 504);

  current = new Date(current.getTime() + 25 * 60 * 60 * 1_000);
  const restartedService = new PendingReportService(dataSource, { async recordAccepted() {} }, delivery, () => current, store);
  await assert.rejects(() => restartedService.confirm({
    previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test",
  }), (error: unknown) => error instanceof PendingReportError && error.status === 409 && /operator must check Resend/.test(error.message));
  assert.equal(providerCalls, 1);
});

test("a provider acceptance whose durable outcome write fails remains unknown and recovers safely after preview expiry", async () => {
  const backing = new InMemoryPendingReportSnapshotStore();
  let failAcceptedWrite = true;
  const store: PendingReportSnapshotStore = {
    create: snapshot => backing.create(snapshot),
    find: id => backing.find(id),
    claim: (id, at) => backing.claim(id, at),
    markAccepted: async (...args) => {
      if (failAcceptedWrite) throw new Error("snapshot database write interrupted");
      return backing.markAccepted(...args);
    },
    markUnknown: (...args) => backing.markUnknown(...args),
    release: (...args) => backing.release(...args),
    markAuditResult: (...args) => backing.markAuditResult(...args),
  };
  let current = new Date(now);
  const keys: string[] = [];
  const provider: PendingReportProvider = {
    async send(message) { keys.push(message.idempotencyKey); return { id: "accepted-at-provider" }; },
  };
  const delivery = () => ({ mode: "demonstration" as const, message: "Mocked; no email is sent.", provider });
  const firstService = new PendingReportService(dataSource, { async recordAccepted() {} }, delivery, () => current, store);
  const preview = await firstService.createPreview("admin-1");
  await assert.rejects(() => firstService.confirm({
    previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test",
  }), /snapshot database write interrupted/);

  // The preview is expired, but recovery may retry exactly this previously
  // attempted key while the provider idempotency record is still valid.
  current = new Date(current.getTime() + 11 * 60 * 1_000);
  failAcceptedWrite = false;
  const restartedService = new PendingReportService(dataSource, { async recordAccepted() {} }, delivery, () => current, store);
  const recovered = await restartedService.confirm({
    previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test",
  });
  assert.equal(recovered.providerId, "accepted-at-provider");
  assert.deepEqual(keys, [keys[0], keys[0]], "both requests use the same provider idempotency key");
});

test("a JSONB-reordered version 1 snapshot validates its fixed legacy canonical hash and confirms", async () => {
  const store = new InMemoryPendingReportSnapshotStore();
  let sentRecipients: readonly string[] = [];
  let sentHtml = "";
  let sentText = "";
  const provider: PendingReportProvider = {
    async send(message) {
      sentRecipients = message.recipients;
      sentHtml = message.html;
      sentText = message.text;
      return { id: "legacy-provider-id" };
    },
  };
  const service = new PendingReportService(
    dataSource,
    { async recordAccepted() {} },
    () => ({ mode: "demonstration" as const, message: "Mocked; no email is sent.", provider }),
    () => now,
    store,
  );
  // This is a persisted v1 JSONB payload represented in a different key order
  // from the object originally hashed. The digest is a fixed fixture generated
  // by the v1 canonical-json implementation in HEAD, not by this test.
  const jsonbReorderedDataset: Parameters<PendingReportSnapshotStore["create"]>[0]["dataset"] = {
    universities: [{
      pendingItems: [{
        remarks: null, targetDateSource: null, targetDate: null, isOverdue: false, isBlocker: false,
        status: "In-Progress", item: "Legacy task", category: "Legacy", classroom: null, space: "Lab", id: "legacy-item",
      }],
      counts: { overdue: 0, blockers: 0, pending: 1 },
      checklistDataState: "available", name: "Legacy University", id: "legacy-university",
    }],
    summary: { universitiesWithoutChecklistData: 0, overdue: 0, blockers: 0, pendingItems: 1 },
    recipients: ["legacy@example.test"],
    scope: { universityCount: 1, kind: "all-active-universities" as const },
    generatedAt: "2026-05-15T12:00:00.000Z",
  };
  const legacySnapshot: Parameters<PendingReportSnapshotStore["create"]>[0] = {
    id: "legacy-v1-jsonb-fixture",
    createdByUserId: "admin-1",
    createdByEmail: "admin@example.test",
    snapshotVersion: 1,
    deliveryMode: "demonstration",
    dataset: jsonbReorderedDataset,
    filename: "pending-work-report-2026-05-15.csv",
    // SHA-256(canonicalJson({ snapshotVersion, deliveryMode, dataset, filename }))
    // from the v1 implementation before v2 snapshots were introduced.
    snapshotHash: "7c7b8c4aa1796fc6504dbbe74fff05d451ddb05d7b9a4acf97ac85f601177f37",
    idempotencyKey: "pending-report-v1-legacy-v1-jsonb-fixture",
    idempotencyExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
    state: "ready",
    leaseToken: null,
    leaseExpiresAt: null,
    attemptedAt: null,
    attemptCount: 0,
    providerId: null,
    providerAcceptedAt: null,
    auditRecorded: null,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1_000),
  };
  await store.create(legacySnapshot);

  const accepted = await service.confirm({
    previewId: legacySnapshot.id, confirmed: true, userId: "admin-1", userEmail: "admin@example.test",
  });
  assert.equal(accepted.providerId, "legacy-provider-id");
  assert.deepEqual(sentRecipients, ["legacy@example.test"]);
  assert.match(sentHtml, /<style>/, "v1 snapshots retain their original styled renderer");
  assert.doesNotMatch(sentHtml, />Classrooms</);
  assert.match(sentText, /Generated: 2026-05-15T12:00:00.000Z/);
});

test("unsupported or tampered structured snapshot versions never reach a provider", async () => {
  const backing = new InMemoryPendingReportSnapshotStore();
  let mutation: "version" | "hash" = "version";
  const store: PendingReportSnapshotStore = {
    create: async snapshot => {
      if (mutation === "version") snapshot.snapshotVersion = 99;
      else snapshot.dataset.summary.pendingItems = 999;
      await backing.create(snapshot);
    },
    find: id => backing.find(id),
    claim: (id, at) => backing.claim(id, at),
    markAccepted: (...args) => backing.markAccepted(...args),
    markUnknown: (...args) => backing.markUnknown(...args),
    release: (...args) => backing.release(...args),
    markAuditResult: (...args) => backing.markAuditResult(...args),
  };
  let providerCalls = 0;
  const provider: PendingReportProvider = { async send() { providerCalls++; return { id: "should-not-send" }; } };
  const delivery = () => ({ mode: "demonstration" as const, message: "Mocked; no email is sent.", provider });
  const service = new PendingReportService(dataSource, { async recordAccepted() {} }, delivery, () => now, store);
  const versionPreview = await service.createPreview("admin-1");
  await assert.rejects(() => service.confirm({
    previewId: versionPreview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test",
  }), (error: unknown) => error instanceof PendingReportError && error.status === 409 && /unsupported version/.test(error.message));

  mutation = "hash";
  const hashPreview = await service.createPreview("admin-1");
  await assert.rejects(() => service.confirm({
    previewId: hashPreview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test",
  }), (error: unknown) => error instanceof PendingReportError && error.status === 409 && /integrity check/.test(error.message));
  assert.equal(providerCalls, 0);
});

test("Resend provider sends the exact fixed snapshot with a CSV attachment and idempotency key", async () => {
  let request: { url: string; init: RequestInit | undefined } | undefined;
  const provider = new ResendPendingReportProvider(
    { apiKey: "test-key-not-a-secret", from: "NIAT InfraTracker <reports@niat.example>" },
    async (input, init) => {
      request = { url: String(input), init };
      return new Response(JSON.stringify({ id: "resend-message-id" }), { status: 200 });
    },
  );
  const result = await provider.send({
    recipients: ["Karthik@nxtwave.tech", "Varshith@nxtwave.tech", "podduturi.sumithreddy@nxtwave.co.in"],
    subject: "Reviewed report", html: "<p>safe</p>", text: "safe", csv: "a,b",
    filename: "reviewed.csv", idempotencyKey: "frozen-preview-key",
  });
  assert.equal(result.id, "resend-message-id");
  assert.ok(request);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal((request.init!.headers as Record<string, string>)["Idempotency-Key"], "frozen-preview-key");
  const body = JSON.parse(request.init!.body as string);
  assert.deepEqual(body.to, ["Karthik@nxtwave.tech", "Varshith@nxtwave.tech", "podduturi.sumithreddy@nxtwave.co.in"]);
  assert.equal(body.from, "NIAT InfraTracker <reports@niat.example>");
  assert.equal(body.attachments[0].filename, "reviewed.csv");
  assert.equal(Buffer.from(body.attachments[0].content, "base64").toString("utf8"), "a,b");
});

test("Resend provider reports verified-sender failures and times out bounded calls", async () => {
  const senderFailure = new ResendPendingReportProvider(
    { apiKey: "test-key-not-a-secret", from: "Reports <reports@niat.example>" },
    async () => new Response("The from domain is not verified", { status: 403 }),
  );
  const message = {
    recipients: ["Karthik@nxtwave.tech"], subject: "Reviewed", html: "x", text: "x", csv: "x",
    filename: "x.csv", idempotencyKey: "key",
  };
  await assert.rejects(
    () => senderFailure.send(message),
    (error: unknown) => error instanceof PendingReportError && error.status === 503 && /Verify/.test(error.message),
  );

  const timeoutProvider = new ResendPendingReportProvider(
    { apiKey: "test-key-not-a-secret", from: "Reports <reports@niat.example>" },
    async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
    1,
  );
  await assert.rejects(
    () => timeoutProvider.send(message),
    (error: unknown) => error instanceof PendingReportError && error.status === 504,
  );
  assert.throws(() => assertProductionPendingSender("onboarding@resend.dev"), /sandbox or test address/);
  assert.throws(() => assertProductionPendingSender("reports@internal.test"), /sandbox or test address/);
});

test("Express pending-report contract rechecks the database admin role and accepts only confirmed snapshots", async (t) => {
  let providerCalls = 0;
  let sentRecipients: readonly string[] = [];
  const provider: PendingReportProvider = { async send(message) {
    providerCalls++;
    sentRecipients = message.recipients;
    return { id: "express-provider-id" };
  } };
  const service = new PendingReportService(
    dataSource,
    { async recordAccepted() {} },
    () => ({ mode: "demonstration" as const, message: "Mocked; no email is sent.", provider }),
    () => now,
    new InMemoryPendingReportSnapshotStore(),
  );
  let currentRole = "apm";
  const app = express();
  app.use(express.json());
  app.use("/api", createPendingReportRouter({
    service,
    getCurrentAdmin: async userId => ({
      id: userId, email: "current-admin@example.test", role: currentRole, isActive: true, isDeleted: false,
    }),
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const token = signToken({
    userId: "admin-1", email: "stale-admin@example.test", role: "admin", name: "Admin", zoneIds: [], universityIds: [],
  });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const staleRole = await fetch(`http://127.0.0.1:${port}/api/reports/pending/preview`, { method: "POST", headers });
  assert.equal(staleRole.status, 403, "an admin claim is not enough after DB demotion");

  currentRole = "admin";
  const previewResponse = await fetch(`http://127.0.0.1:${port}/api/reports/pending/preview`, { method: "POST", headers });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as { previewId: string; recipients: string[]; delivery: { mode: string } };
  assert.equal(preview.delivery.mode, "demonstration");
  assert.deepEqual(preview.recipients, [
    "karthik@nxtwave.tech", "Varshith@nxtwave.tech", "satish.jada@nxtwave.co.in",
    "srinivas.vatturi@nxtwave.tech", "ramesh@nxtwave.co.in",
  ]);

  const invalidSend = await fetch(`http://127.0.0.1:${port}/api/reports/pending/send`, {
    method: "POST", headers, body: JSON.stringify({ previewId: preview.previewId, confirmed: true, recipients: ["attacker@example.test"] }),
  });
  assert.equal(invalidSend.status, 400);
  const sent = await fetch(`http://127.0.0.1:${port}/api/reports/pending/send`, {
    method: "POST", headers, body: JSON.stringify({ previewId: preview.previewId, confirmed: true }),
  });
  assert.equal(sent.status, 200);
  assert.equal((await sent.json() as { accepted: boolean }).accepted, true);
  assert.equal(providerCalls, 1);
  assert.deepEqual(sentRecipients, preview.recipients, "confirmation sends only the reviewed recipients");
});