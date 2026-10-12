import assert from "node:assert/strict";
import test from "node:test";
import { selectApplicableEvidence, withReportGenerationAdmission } from "./dailyReport";

test("report admission bounds generation without blocking unrelated work", async () => {
  let active = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const started: number[] = [];
  const jobs = Array.from({ length: 5 }, (_, index) =>
    withReportGenerationAdmission(async () => {
      active += 1;
      peak = Math.max(peak, active);
      started.push(index);
      await new Promise<void>(resolve => releases.push(resolve));
      active -= 1;
      return index;
    })
  );

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(peak, 2);
  assert.equal(started.length, 2);
  const unrelated = await Promise.resolve("portal request succeeded");
  assert.equal(unrelated, "portal request succeeded");

  while (releases.length || started.length < jobs.length) {
    releases.shift()?.();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
});

test("selects the latest evidence uploaded by the report date", () => {
  const cutoff = new Date("2026-09-09T23:59:59.999Z");
  const applicable = selectApplicableEvidence([
    { id: "future", photoUrl: "/future.mp4", contentType: "video/mp4", uploadedAt: new Date("2026-09-10T09:00:00Z") },
    { id: "latest", photoUrl: "/latest.jpg", contentType: "image/jpeg", uploadedAt: new Date("2026-09-09T14:00:00Z") },
    { id: "old", photoUrl: "/old.jpg", contentType: "image/jpeg", uploadedAt: new Date("2026-09-08T14:00:00Z") },
  ], {
    photoUrl: "/future.mp4",
    photoContentType: "video/mp4",
    updatedAt: new Date("2026-09-10T09:00:00Z"),
  }, cutoff);

  assert.equal(applicable?.id, "latest");
  assert.equal(applicable?.contentType, "image/jpeg");
});

test("does not expose a current attachment created after the report date", () => {
  const applicable = selectApplicableEvidence([], {
    photoUrl: "/future.jpg",
    photoContentType: "image/jpeg",
    updatedAt: new Date("2026-09-10T09:00:00Z"),
  }, new Date("2026-09-09T23:59:59.999Z"));

  assert.equal(applicable, null);
});

test("supports a legacy current attachment that existed by the report date", () => {
  const applicable = selectApplicableEvidence([], {
    photoUrl: "/legacy.mov",
    photoContentType: "video/quicktime",
    updatedAt: new Date("2026-09-08T09:00:00Z"),
  }, new Date("2026-09-09T23:59:59.999Z"));

  assert.equal(applicable?.photoUrl, "/legacy.mov");
  assert.equal(applicable?.contentType, "video/quicktime");
});