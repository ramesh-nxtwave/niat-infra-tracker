import assert from "node:assert/strict";
import test from "node:test";
import {
  collectAuthorizationUniversityIds,
  answerEquipmentAvailabilityQuestion,
  isAuthorizationProvenanceAllowed,
  MAX_ASSISTANT_SOURCE_RECORDS,
  resolveScopedUniversities,
  selectContextRecords,
  type GroundedRecord,
} from "./assistantSupport";

const universities = [
  { id: "north", name: "Northbridge University", zoneId: 1 },
  { id: "south", name: "Southfield University", zoneId: 2 },
  { id: "west", name: "Westlake University", zoneId: 2 },
];

test("explicit all-universities scope overrides historical university context", () => {
  const scoped = resolveScopedUniversities(
    universities,
    "Now compare readiness across all universities",
    ["Show readiness for Northbridge University"],
  );
  assert.deepEqual(scoped.map(university => university.id), ["north", "south", "west"]);
});

test("university count and list questions cover every authorized university", () => {
  const counted = resolveScopedUniversities(
    universities,
    "How many universities don't have TV?",
    [],
  );
  const listed = resolveScopedUniversities(
    universities,
    "Which universities are delayed?",
    [],
  );
  assert.deepEqual(counted.map(university => university.id), ["north", "south", "west"]);
  assert.deepEqual(listed.map(university => university.id), ["north", "south", "west"]);
});

test("current university and zone scopes override historical context", () => {
  const switchedUniversity = resolveScopedUniversities(
    universities,
    "Switch to Southfield University",
    ["Show readiness for Northbridge University"],
  );
  assert.deepEqual(switchedUniversity.map(university => university.id), ["south"]);

  const switchedZone = resolveScopedUniversities(
    universities,
    "Export that for Zone 2",
    ["Show readiness for Northbridge University"],
  );
  assert.deepEqual(switchedZone.map(university => university.id), ["south", "west"]);
});

test("unresolved follow-ups inherit the prior university scope", () => {
  const scoped = resolveScopedUniversities(
    universities,
    "Only show delayed items",
    ["Show readiness for Northbridge University"],
  );
  assert.deepEqual(scoped.map(university => university.id), ["north"]);
});

test("unresolved follow-ups inherit only the latest explicit scope change", () => {
  const universitySwitch = resolveScopedUniversities(
    universities,
    "Only show delayed items",
    ["Show Northbridge University", "Switch to Southfield University"],
  );
  assert.deepEqual(universitySwitch.map(university => university.id), ["south"]);

  const zoneSwitch = resolveScopedUniversities(
    universities,
    "Which of those is most delayed?",
    ["Show Northbridge University", "Now use Zone 2"],
  );
  assert.deepEqual(zoneSwitch.map(university => university.id), ["south", "west"]);

  const broadened = resolveScopedUniversities(
    universities,
    "Only show delayed items",
    ["Show Northbridge University", "Now compare all universities"],
  );
  assert.deepEqual(broadened.map(university => university.id), ["north", "south", "west"]);
});

test("authorization provenance includes every supplied and reused university, not only citations", () => {
  const contextRecords: GroundedRecord[] = [
    {
      id: "record-a",
      universityId: "north",
      university: "Northbridge University",
      area: "Classroom",
      category: "Readiness",
      lineItem: "Projector",
      status: "Pending",
      timeline: null,
      remarks: null,
      updatedAt: "2026-09-09T00:00:00.000Z",
    },
    {
      id: "record-b",
      universityId: "south",
      university: "Southfield University",
      area: "Classroom",
      category: "Readiness",
      lineItem: "Projector",
      status: "Pending",
      timeline: null,
      remarks: null,
      updatedAt: "2026-09-09T00:00:00.000Z",
    },
  ];
  const dependencies = collectAuthorizationUniversityIds(contextRecords, ["west"]);

  assert.deepEqual(dependencies, ["north", "south", "west"]);
  assert.equal(isAuthorizationProvenanceAllowed(true, dependencies, new Set(["north", "west"])), false);
  assert.equal(isAuthorizationProvenanceAllowed(true, dependencies, new Set(["north", "south", "west"])), true);
  assert.equal(isAuthorizationProvenanceAllowed(false, [], null), false);
});

test("model context never exceeds the number of source rows persisted with an answer", () => {
  const records: GroundedRecord[] = Array.from({ length: 125 }, (_, index) => ({
    id: `record-${index}`,
    universityId: `university-${index}`,
    university: `University ${index}`,
    area: "Classroom",
    category: "Readiness",
    lineItem: "Projector",
    status: "Pending",
    timeline: null,
    remarks: null,
    updatedAt: "2026-09-09T00:00:00.000Z",
  }));

  assert.equal(selectContextRecords(records, "pending").length, MAX_ASSISTANT_SOURCE_RECORDS);
});

test("TV availability uses current status and ignores contradictory remarks", () => {
  const records: GroundedRecord[] = [
    {
      id: "smr-tv",
      universityId: "smr",
      university: "SMR University",
      area: "Model Classroom",
      category: "TV, AV & WIFI",
      lineItem: "TV - Working",
      status: "Done",
      timeline: null,
      remarks: "TV is not available",
      updatedAt: "2026-09-09T00:00:00.000Z",
    },
    {
      id: "north-tv",
      universityId: "north",
      university: "Northbridge University",
      area: "Model Classroom",
      category: "TV, AV & WIFI",
      lineItem: "TV - Working",
      status: "Yet to start",
      timeline: null,
      remarks: "TV has arrived",
      updatedAt: "2026-09-09T00:00:00.000Z",
    },
    {
      id: "smr-update",
      universityId: "smr",
      university: "SMR University",
      area: "Daily updates",
      category: "Update",
      lineItem: "University update",
      status: "Update",
      timeline: null,
      remarks: "No TV",
      updatedAt: "2026-09-09T00:00:00.000Z",
    },
  ];

  const selected = selectContextRecords(records, "How many universities don't have TV?");
  assert.deepEqual(selected.map(record => record.id).sort(), ["north-tv", "smr-tv"]);

  const result = answerEquipmentAvailabilityQuestion(selected, "How many universities don't have TV?");
  assert.ok(result);
  assert.match(result.answer, /1 university does not yet have/);
  assert.match(result.answer, /Northbridge University/);
  assert.doesNotMatch(result.answer, /SMR University/);
  assert.deepEqual(result.recordIds, ["availability-tv-north"]);
  assert.equal(result.sourceRecords.length, 1);
  assert.equal(result.sourceRecords[0].area, "University-wide");
});

test("UPS availability returns only records from universities without completed UPS status", () => {
  const records: GroundedRecord[] = [
    {
      id: "smr-ups",
      universityId: "smr",
      university: "SMR University",
      area: "Lab",
      category: "UPS / Power Backup",
      lineItem: "UPS Power Connection",
      status: "Done",
      timeline: null,
      remarks: "UPS is not available",
      updatedAt: "2026-09-09T00:00:00.000Z",
    },
    {
      id: "north-ups",
      universityId: "north",
      university: "Northbridge University",
      area: "Lab",
      category: "UPS / Power Backup",
      lineItem: "UPS Power Connection",
      status: "In-Progress",
      timeline: null,
      remarks: "UPS delivered",
      updatedAt: "2026-09-09T00:00:00.000Z",
    },
  ];

  const result = answerEquipmentAvailabilityQuestion(records, "Which universities don't have UPS?");
  assert.ok(result);
  assert.match(result.answer, /Northbridge University/);
  assert.doesNotMatch(result.answer, /SMR University/);
  assert.deepEqual(result.recordIds, ["availability-ups-north"]);
  assert.equal(result.sourceRecords.length, 1);
  assert.equal(result.sourceRecords[0].area, "University-wide");
});

test("UPS availability collapses classroom statuses to one university-level source row", () => {
  const records: GroundedRecord[] = [
    {
      id: "north-room-1",
      universityId: "north",
      university: "Northbridge University",
      area: "Classroom 1",
      category: "Electrical",
      lineItem: "UPS Power Connection",
      status: "Yet to start",
      timeline: null,
      remarks: null,
      updatedAt: "2026-09-08T00:00:00.000Z",
    },
    {
      id: "north-room-2",
      universityId: "north",
      university: "Northbridge University",
      area: "Classroom 2",
      category: "Electrical",
      lineItem: "UPS Power Connection",
      status: "In-Progress",
      timeline: null,
      remarks: null,
      updatedAt: "2026-09-09T00:00:00.000Z",
    },
  ];

  const result = answerEquipmentAvailabilityQuestion(records, "Which universities don't have UPS?");
  assert.ok(result);
  assert.equal(result.sourceRecords.length, 1);
  assert.equal(result.sourceRecords[0].university, "Northbridge University");
  assert.equal(result.sourceRecords[0].area, "University-wide");
  assert.equal(result.sourceRecords[0].status, "In-Progress / Yet to start");
});