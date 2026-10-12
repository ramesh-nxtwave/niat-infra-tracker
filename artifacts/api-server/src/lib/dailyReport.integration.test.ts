import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { buildDailyReport, invalidateDailyReport } from "./dailyReport";

test("daily reports count Partially Done as pending without increasing readiness", async (t) => {
  const suffix = `${process.pid}-${Date.now()}`;
  const university = await prisma.university.create({
    data: { code: `DRPD-${suffix}`, name: `Partially done report ${suffix}` },
  });
  const item = await prisma.checklistItem.create({
    data: { module: "lab", category: "Status", name: `Partially done item ${suffix}` },
  });
  const space = await prisma.space.create({
    data: { universityId: university.id, spaceType: "lab", name: "5.0 Lab" },
  });
  const status = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: university.id,
      spaceId: space.id,
      checklistItemId: item.id,
      currentStatus: "Partially Done",
    },
  });

  t.after(async () => {
    await prisma.university.delete({ where: { id: university.id } });
    await prisma.checklistItem.delete({ where: { id: item.id } });
  });

  const now = new Date();
  const report = await buildDailyReport(university.id, now.toISOString().slice(0, 10), {
    now,
    bypassCache: true,
  });

  assert.equal(report?.items.find(entry => entry.id === status.id)?.status, "Partially Done");
  assert.equal(report?.summary.pending, 1);
  assert.equal(report?.summary.inProgress, 0);
  assert.equal(report?.summary.completedToday, 0);
  assert.equal(report?.summary.overallReadiness, 0);
  assert.equal(report?.areaSummaries[0]?.complete, 0);
  assert.equal(report?.areaSummaries[0]?.readiness, 0);
});

test("daily reports use a bounded query path and preserve historical snapshots and evidence", async (t) => {
  const suffix = `${process.pid}-${Date.now()}`;
  const university = await prisma.university.create({
    data: { code: `DRP-${suffix}`, name: `Daily report performance ${suffix}`, location: "Test city" },
  });
  const item = await prisma.checklistItem.create({
    data: { module: "lab", category: "Performance", name: `Report item ${suffix}` },
  });
  const nullRemarkItem = await prisma.checklistItem.create({
    data: { module: "lab", category: "Performance", name: `Null remark item ${suffix}` },
  });
  const space = await prisma.space.create({
    data: { universityId: university.id, spaceType: "lab", name: "5.0 Lab" },
  });
  const status = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: university.id,
      spaceId: space.id,
      checklistItemId: item.id,
      currentStatus: "Done",
      remarks: "Current remark",
      universityTimeline: "2026-09-20",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      updatedAt: new Date("2026-09-10T10:00:00Z"),
      photoUrl: "/current.jpg",
      photoContentType: "image/jpeg",
    },
  });
  const nullRemarkStatus = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: university.id,
      spaceId: space.id,
      checklistItemId: nullRemarkItem.id,
      currentStatus: "Done",
      remarks: "Current remark added later",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      updatedAt: new Date("2026-09-10T10:00:00Z"),
    },
  });

  t.after(async () => {
    await prisma.university.delete({ where: { id: university.id } });
    await prisma.checklistItem.deleteMany({ where: { id: { in: [item.id, nullRemarkItem.id] } } });
  });

  const historyRows = Array.from({ length: 500 }, (_, index) => ({
    statusId: status.id,
    universityId: university.id,
    currentStatus: index < 300 ? "Yet to start" : "In-Progress",
    remarks: index < 300 ? "Initial remark" : "Historical remark",
    universityTimeline: "2026-09-20",
    isBlocker: false,
    changedAt: new Date(Date.UTC(2026, 8, 1, 0, index)),
  }));
  await prisma.checklistStatusHistory.createMany({ data: historyRows });
  await prisma.checklistStatusHistory.createMany({
    data: [
      {
        statusId: nullRemarkStatus.id, universityId: university.id,
        currentStatus: "Yet to start", remarks: null, isBlocker: false,
        changedAt: new Date("2026-09-01T01:00:00Z"),
      },
      {
        statusId: nullRemarkStatus.id, universityId: university.id,
        currentStatus: "Yet to start", remarks: "Temporary remark", isBlocker: false,
        changedAt: new Date("2026-09-01T02:00:00Z"),
      },
      {
        statusId: nullRemarkStatus.id, universityId: university.id,
        currentStatus: "In-Progress", remarks: null, isBlocker: false,
        changedAt: new Date("2026-09-01T03:00:00Z"),
      },
    ],
  });
  await prisma.photoHistory.createMany({
    data: Array.from({ length: 200 }, (_, index) => ({
      statusId: status.id,
      photoUrl: `/evidence-${index}.jpg`,
      contentType: "image/jpeg",
      uploadedAt: new Date(Date.UTC(2026, 8, 1, 0, index)),
    })),
  });
  let queryCount = 0;
  const report = await buildDailyReport(university.id, "2026-09-01", {
    now: new Date("2026-09-11T00:00:00Z"),
    bypassCache: true,
    onQuery: () => { queryCount += 1; },
  });

  assert.equal(queryCount, 2, "report generation must remain bounded to two database queries");
  assert.equal(report?.items.length, 2);
  const historicalItem = report?.items.find(entry => entry.id === status.id);
  assert.equal(historicalItem?.status, "In-Progress");
  assert.equal(historicalItem?.remark, "Historical remark");
  assert.equal(historicalItem?.attachments[0].url, "/evidence-199.jpg");
  const nullRemarkReportItem = report?.items.find(entry => entry.id === nullRemarkStatus.id);
  assert.equal(nullRemarkReportItem?.status, "In-Progress");
  assert.equal(nullRemarkReportItem?.remark, null);
  assert.equal(
    nullRemarkReportItem?.remarkDate.toISOString(),
    "2026-09-01T01:00:00.000Z",
  );
  assert.equal(historicalItem?.remarkIsHistorical, true);
  assert.equal(historicalItem?.remarkDiffersFromCurrent, true);
  assert.equal(nullRemarkReportItem?.remarkIsHistorical, true);
  assert.equal(nullRemarkReportItem?.remarkDiffersFromCurrent, true);
});

test("daily report history has a usable publish-compatible status/date index", async () => {
  // Check index eligibility, not the cost-based plan for a small fixture. PostgreSQL
  // can legitimately prefer a sequential scan depending on the database statistics.
  const indexes = await prisma.$queryRaw<Array<{
    valid: boolean;
    ready: boolean;
    live: boolean;
    method: string;
    keyCount: number;
    firstKey: string;
    secondKey: string;
    predicate: string | null;
  }>>(Prisma.sql`
    SELECT i.indisvalid AS valid, i.indisready AS ready, i.indislive AS live,
      am.amname AS method, i.indnkeyatts::int AS "keyCount",
      pg_get_indexdef(i.indexrelid, 1, true) AS "firstKey",
      pg_get_indexdef(i.indexrelid, 2, true) AS "secondKey",
      pg_get_expr(i.indpred, i.indrelid) AS predicate
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_am am ON am.oid = c.relam
    WHERE i.indrelid = 'checklist_status_history'::regclass
      AND c.relname = 'checklist_status_history_status_id_changed_at_idx'
  `);
  assert.deepEqual(indexes, [{
    valid: true,
    ready: true,
    live: true,
    method: "btree",
    keyCount: 2,
    firstKey: "status_id",
    secondKey: "changed_at",
    predicate: null,
  }], "history lookup needs a valid, ready, non-partial B-tree index on status/date");
});

test("daily report provenance compares raw historical and live remarks", async (t) => {
  const suffix = `${process.pid}-${Date.now()}`;
  const university = await prisma.university.create({
    data: { code: `DRR-${suffix}`, name: `Daily report remarks ${suffix}` },
  });
  const item = await prisma.checklistItem.create({
    data: { module: "lab", category: "Remarks", name: `Remark item ${suffix}` },
  });
  const space = await prisma.space.create({
    data: { universityId: university.id, spaceType: "lab", name: "5.0 Lab" },
  });
  const status = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: university.id,
      spaceId: space.id,
      checklistItemId: item.id,
      currentStatus: "In-Progress",
      remarks: "2 Sep 2026 - Shared visible remark",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      updatedAt: new Date("2026-09-10T10:00:00Z"),
    },
  });

  t.after(async () => {
    await prisma.university.delete({ where: { id: university.id } });
    await prisma.checklistItem.delete({ where: { id: item.id } });
  });

  await prisma.checklistStatusHistory.create({
    data: {
      statusId: status.id,
      universityId: university.id,
      currentStatus: "In-Progress",
      remarks: "1 Sep 2026 - Shared visible remark",
      isBlocker: false,
      changedAt: new Date("2026-09-01T12:00:00Z"),
    },
  });

  const historical = await buildDailyReport(university.id, "2026-09-01", {
    now: new Date("2026-09-11T12:00:00Z"),
    bypassCache: true,
  });
  const historicalItem = historical?.items.find(entry => entry.id === status.id);
  assert.equal(historicalItem?.remark, "Shared visible remark");
  assert.equal(historicalItem?.remarkIsHistorical, true);
  assert.equal(historicalItem?.remarkDiffersFromCurrent, true);

  const current = await buildDailyReport(university.id, "2026-09-11", {
    now: new Date("2026-09-11T12:00:00Z"),
    bypassCache: true,
  });
  const currentItem = current?.items.find(entry => entry.id === status.id);
  assert.equal(currentItem?.remark, "Shared visible remark");
  assert.equal(currentItem?.remarkIsHistorical, false);
  assert.equal(currentItem?.remarkDiffersFromCurrent, false);
});

test("equivalent current report loads coalesce and invalidation exposes checklist changes", async (t) => {
  const suffix = `${process.pid}-${Date.now()}`;
  const university = await prisma.university.create({
    data: { code: `DRC-${suffix}`, name: `Daily report cache ${suffix}` },
  });
  const item = await prisma.checklistItem.create({
    data: { module: "staff_room", category: "Cache", name: `Cache item ${suffix}` },
  });
  const space = await prisma.space.create({
    data: { universityId: university.id, spaceType: "staff_room", name: "Staff Room" },
  });
  const status = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: university.id,
      spaceId: space.id,
      checklistItemId: item.id,
      currentStatus: "Yet to start",
    },
  });

  t.after(async () => {
    await prisma.university.delete({ where: { id: university.id } });
    await prisma.checklistItem.delete({ where: { id: item.id } });
  });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  invalidateDailyReport(university.id);
  let queryCount = 0;
  const reports = await Promise.all(Array.from({ length: 4 }, () =>
    buildDailyReport(university.id, date, {
      now,
      onQuery: () => { queryCount += 1; },
    })
  ));
  assert.equal(queryCount, 2, "overlapping equivalent loads should share one generation");
  assert.ok(reports.every(report => report === reports[0]));
  assert.equal(reports[0]?.items[0].status, "Yet to start");

  await prisma.spaceChecklistStatus.update({
    where: { id: status.id },
    data: { currentStatus: "Done" },
  });
  invalidateDailyReport(university.id);
  const refreshed = await buildDailyReport(university.id, date, { now });
  assert.equal(refreshed?.items[0].status, "Done");
});

test("equivalent historical report loads coalesce without caching later requests", async (t) => {
  const suffix = `${process.pid}-${Date.now()}`;
  const university = await prisma.university.create({
    data: { code: `DRH-${suffix}`, name: `Historical report coalescing ${suffix}` },
  });
  t.after(() => prisma.university.delete({ where: { id: university.id } }));
  let queryCount = 0;
  const options = {
    now: new Date("2026-09-18T00:00:00Z"),
    onQuery: () => { queryCount += 1; },
  };
  const first = await Promise.all(Array.from({ length: 8 }, () =>
    buildDailyReport(university.id, "2026-09-01", options)
  ));
  assert.equal(queryCount, 2);
  assert.ok(first.every(report => report === first[0]));
  await buildDailyReport(university.id, "2026-09-01", options);
  assert.equal(queryCount, 4, "historical work is coalesced only while in flight");
});