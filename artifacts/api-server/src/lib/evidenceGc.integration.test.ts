import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import express from "express";
import { signToken } from "../lib/auth";
import evidenceGcRouter from "../routes/evidenceGc";
import prisma from "./prisma";
import {
  applyEvidenceGc,
  canonicalEvidenceObjectPath,
  ensureEvidenceGcSchema,
  registerEvidenceUploadIntent,
  runEvidenceGcDryRun,
} from "./evidenceGc";
import type { EvidenceGcApplyResult } from "./evidenceGc";
import { ControlledEvidenceStorage } from "./evidenceGc.test-fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

type Cleanup = {
  paths?: string[];
  runIds?: string[];
  universityIds?: string[];
  checklistItemIds?: string[];
  snapshotIds?: string[];
};

function ownedPath(): string {
  return `/objects/uploads/${randomUUID()}`;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

async function ageObject(
  objectPath: string,
  options: { eligibleAt?: Date } = {},
) {
  await prisma.evidenceObject.update({
    where: { objectPath },
    data: {
      createdAt: daysAgo(60),
      retentionUntil: daysAgo(1),
      eligibleAt: options.eligibleAt,
      eligibilityReason: options.eligibleAt
        ? "test fixture is unreferenced"
        : null,
    },
  });
}

async function cleanupFixture(fixture: Cleanup) {
  const runIds = fixture.runIds ?? [];
  if (runIds.length > 0) {
    await prisma.evidenceGcRun.deleteMany({ where: { id: { in: runIds } } });
  }
  if (fixture.snapshotIds?.length) {
    await prisma.pendingReportSnapshot.deleteMany({
      where: { id: { in: fixture.snapshotIds } },
    });
  }
  if (fixture.universityIds?.length) {
    await prisma.university.deleteMany({
      where: { id: { in: fixture.universityIds } },
    });
  }
  if (fixture.checklistItemIds?.length) {
    await prisma.checklistItem.deleteMany({
      where: { id: { in: fixture.checklistItemIds } },
    });
  }

  const objects = fixture.paths?.length
    ? await prisma.evidenceObject.findMany({
        where: { objectPath: { in: fixture.paths } },
        select: { id: true },
      })
    : [];
  const objectIds = objects.map((object) => object.id);
  if (objectIds.length > 0) {
    // Runs created by a failed test may not have made it into runIds yet.
    const attachedRuns = await prisma.evidenceGcAttempt.findMany({
      where: { objectId: { in: objectIds } },
      select: { runId: true },
    });
    await prisma.evidenceGcRun.deleteMany({
      where: {
        id: {
          in: Array.from(new Set(attachedRuns.map((attempt) => attempt.runId))),
        },
      },
    });
    await prisma.evidenceObjectReference.deleteMany({
      where: { objectId: { in: objectIds } },
    });
    await prisma.evidenceObject.deleteMany({ where: { id: { in: objectIds } } });
  }
}

async function createStatusSource(
  cleanup: Cleanup,
  label: string,
  photoUrl: string | null = null,
) {
  const university = await prisma.university.create({
    data: {
      code: `GC-${label}-${randomUUID().slice(0, 8)}`,
      name: `Evidence GC ${label}`,
    },
  });
  const item = await prisma.checklistItem.create({
    data: {
      module: "model_classroom",
      category: "Evidence GC",
      name: `Evidence GC ${label}`,
    },
  });
  const space = await prisma.space.create({
    data: {
      universityId: university.id,
      spaceType: "model_classroom",
      name: `GC room ${label}`,
    },
  });
  const status = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: university.id,
      spaceId: space.id,
      checklistItemId: item.id,
      photoUrl,
      photoContentType: photoUrl ? "image/jpeg" : null,
    },
  });
  cleanup.universityIds ??= [];
  cleanup.universityIds.push(university.id);
  cleanup.checklistItemIds ??= [];
  cleanup.checklistItemIds.push(item.id);
  return { university, item, space, status };
}

async function applyAfterDryRun(
  cleanup: Cleanup,
  storage: ControlledEvidenceStorage,
  options: { limit?: number; retentionDays?: number } = {},
) {
  const dryRun = await runEvidenceGcDryRun(options);
  cleanup.runIds ??= [];
  cleanup.runIds.push(dryRun.runId);
  const result = await applyEvidenceGc({
    dryRunId: dryRun.runId,
    storage,
    ...options,
  });
  cleanup.runIds.push(result.runId);
  return { dryRun, result };
}

async function withEvidenceGcAttemptAuditFailure<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const client = prisma as typeof prisma & {
    $transaction: (...args: any[]) => Promise<unknown>;
  };
  const originalTransaction = client.$transaction.bind(prisma);
  let shouldFail = true;
  client.$transaction = (async (callbackOrBatch: unknown, options?: unknown) => {
    if (typeof callbackOrBatch !== "function") {
      return originalTransaction(callbackOrBatch, options);
    }
    return originalTransaction(async (tx: any) => {
      const attemptDelegate = new Proxy(tx.evidenceGcAttempt, {
        get(target, property, receiver) {
          if (property === "update" && shouldFail) {
            shouldFail = false;
            return async () => {
              throw new Error("controlled evidence GC audit update failure");
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const proxiedTransaction = new Proxy(tx, {
        get(target, property, receiver) {
          if (property === "evidenceGcAttempt") return attemptDelegate;
          return Reflect.get(target, property, receiver);
        },
      });
      return (callbackOrBatch as (transaction: unknown) => Promise<unknown>)(
        proxiedTransaction,
      );
    }, options);
  }) as typeof client.$transaction;
  try {
    return await operation();
  } finally {
    client.$transaction = originalTransaction;
  }
}

describe("evidence GC integration", { concurrency: false }, () => {

test("canonicalizes only owned evidence paths and strips media metadata", () => {
  const id = randomUUID().toUpperCase();
  assert.equal(
    canonicalEvidenceObjectPath(`  /objects/uploads/${id}?media=video#preview `),
    `/objects/uploads/${id.toLowerCase()}`,
  );
  assert.equal(
    canonicalEvidenceObjectPath(`https://cdn.example.test/objects/uploads/${id}`),
    `/objects/uploads/${id.toLowerCase()}`,
  );
  assert.equal(canonicalEvidenceObjectPath("/uploads/legacy.jpg"), null);
  assert.equal(
    canonicalEvidenceObjectPath(`/objects/uploads/${id}/nested`),
    null,
  );
  assert.equal(
    canonicalEvidenceObjectPath(
      `https://cdn.example.test/report/objects/uploads/${id}`,
    ),
    null,
  );
  assert.equal(canonicalEvidenceObjectPath("not-a-path"), null);
});

test("database triggers index current, gallery, and cross-university references", async (t) => {
  await ensureEvidenceGcSchema();
  const cleanup: Cleanup = { paths: [] };
  t.after(() => cleanupFixture(cleanup));

  const sharedPath = ownedPath();
  const candidatePath = ownedPath();
  cleanup.paths!.push(sharedPath, candidatePath);
  await Promise.all([
    registerEvidenceUploadIntent({ objectPath: sharedPath }),
    registerEvidenceUploadIntent({ objectPath: candidatePath }),
  ]);

  const source = await createStatusSource(cleanup, "source", sharedPath);
  await prisma.photoHistory.create({
    data: {
      statusId: source.status.id,
      photoUrl: sharedPath,
      contentType: "image/jpeg",
    },
  });
  const foreign = await createStatusSource(cleanup, "foreign", sharedPath);
  await ageObject(sharedPath, { eligibleAt: daysAgo(31) });
  await ageObject(candidatePath, { eligibleAt: daysAgo(31) });

  const references = await prisma.evidenceObjectReference.findMany({
    where: { object: { objectPath: sharedPath } },
    select: { sourceType: true, sourceId: true, sourceField: true },
    orderBy: [{ sourceType: "asc" }, { sourceField: "asc" }],
  });
  assert.deepEqual(
    references.map((reference) => ({
      sourceType: reference.sourceType,
      sourceField: reference.sourceField,
    })),
    [
      { sourceType: "photo_history", sourceField: "photo_url" },
      { sourceType: "space_checklist_status", sourceField: "photo_url" },
      { sourceType: "space_checklist_status", sourceField: "photo_url" },
    ],
  );
  assert.equal(
    new Set(references.map((reference) => reference.sourceId)).size,
    3,
    "each current/gallery/cross-university source is globally indexed",
  );

  const storage = new ControlledEvidenceStorage();
  storage.seed(sharedPath, "shared evidence");
  storage.seed(candidatePath, "candidate evidence");
  storage.delayDeletes();
  const applyPromise = applyAfterDryRun(cleanup, storage, { limit: 1 });
  await storage.waitForDeleteStart();

  // The competing deletion is for the unreferenced object. Every reference
  // in every university remains a readable root while its sibling is deleted.
  assert.equal(new TextDecoder().decode(storage.read(sharedPath)), "shared evidence");
  assert.equal(
    await prisma.evidenceObject.findUniqueOrThrow({
      where: { objectPath: sharedPath },
      select: { state: true },
    }).then((object) => object.state),
    "active",
  );
  assert.equal(foreign.university.id === source.university.id, false);

  storage.releaseDeletes();
  await applyPromise;
  assert.equal(storage.deleteCalls.length, 1);
  assert.equal(storage.deleteCalls[0], candidatePath);
  assert.equal(storage.objects.has(sharedPath), true);
  assert.equal(storage.objects.has(candidatePath), false);
});

test("eligibility is recoverable and deletion waits for grace since last unreference", async (t) => {
  await ensureEvidenceGcSchema();
  const cleanup: Cleanup = { paths: [] };
  t.after(() => cleanupFixture(cleanup));

  const path = ownedPath();
  cleanup.paths!.push(path);
  await registerEvidenceUploadIntent({
    objectPath: `${path}?media=image`,
    contentType: "image/jpeg",
    sizeBytes: 123,
    originalName: "grace.jpg",
  });
  await ageObject(path);

  const storage = new ControlledEvidenceStorage();
  storage.seed(path);

  // The first bounded apply marks an old, unreferenced object while it is
  // still active. It must not call storage or turn an operator-recoverable
  // eligibility mark into a deletion tombstone.
  const first = await applyAfterDryRun(cleanup, storage);
  assert.equal(first.result.deletedCount, 0);
  assert.equal(first.result.markedDeleting, 0);
  assert.equal(storage.deleteCalls.length, 0);
  let object = await prisma.evidenceObject.findUniqueOrThrow({
    where: { objectPath: path },
  });
  assert.equal(object.state, "active");
  assert(object.eligibleAt);
  assert.equal(object.deleteAttempts, 0);

  // Creation age is intentionally much older than the grace period. A mark
  // from 29 days ago is still protected; cleanup must use eligibleAt rather
  // than createdAt as the second clock.
  await prisma.evidenceObject.update({
    where: { objectPath: path },
    data: { eligibleAt: daysAgo(29) },
  });
  const withinGrace = await applyAfterDryRun(cleanup, storage);
  assert.equal(withinGrace.result.deletedCount, 0);
  assert.equal(storage.deleteCalls.length, 0);
  object = await prisma.evidenceObject.findUniqueOrThrow({
    where: { objectPath: path },
  });
  assert.equal(object.state, "active");
  assert(object.eligibleAt);

  await prisma.evidenceObject.update({
    where: { objectPath: path },
    data: { eligibleAt: daysAgo(31) },
  });
  const afterGrace = await applyAfterDryRun(cleanup, storage);
  assert.equal(afterGrace.result.deletedCount, 1);
  assert.equal(storage.deleteCalls.length, 1);
  assert.equal(
    await prisma.evidenceObject.findUniqueOrThrow({
      where: { objectPath: path },
      select: { state: true },
    }).then((row) => row.state),
    "deleted",
  );
});

test("a new reference cancels an active eligibility mark, while a deleting tombstone rejects late references", async (t) => {
  await ensureEvidenceGcSchema();
  const cleanup: Cleanup = { paths: [] };
  t.after(() => cleanupFixture(cleanup));

  const recoverablePath = ownedPath();
  const deletingPath = ownedPath();
  cleanup.paths!.push(recoverablePath, deletingPath);
  await Promise.all([
    registerEvidenceUploadIntent({ objectPath: recoverablePath }),
    registerEvidenceUploadIntent({ objectPath: deletingPath }),
  ]);
  await ageObject(recoverablePath);
  await ageObject(deletingPath, { eligibleAt: daysAgo(31) });

  const recoverySource = await createStatusSource(cleanup, "recovery");
  const storage = new ControlledEvidenceStorage();
  storage.seed(recoverablePath);
  storage.seed(deletingPath);
  const marked = await applyAfterDryRun(cleanup, storage);
  assert.equal(marked.result.markedDeleting, 1);
  assert.equal(marked.result.deletedCount, 1);
  assert.equal(storage.deleteCalls.length, 1);
  assert.equal(storage.deleteCalls[0], deletingPath);

  const recoverable = await prisma.evidenceObject.findUniqueOrThrow({
    where: { objectPath: recoverablePath },
  });
  assert.equal(recoverable.state, "active");
  assert(recoverable.eligibleAt);

  await prisma.spaceChecklistStatus.update({
    where: { id: recoverySource.status.id },
    data: { photoUrl: recoverablePath, photoContentType: "image/jpeg" },
  });
  assert.deepEqual(
    await prisma.evidenceObject.findUniqueOrThrow({
      where: { objectPath: recoverablePath },
      select: { state: true, eligibleAt: true },
    }),
    { state: "active", eligibleAt: null },
  );

  await prisma.university.delete({ where: { id: recoverySource.university.id } });
  assert.deepEqual(
    await prisma.evidenceObject.findUniqueOrThrow({
      where: { objectPath: recoverablePath },
      select: { state: true, eligibleAt: true },
    }),
    { state: "active", eligibleAt: null },
  );

  // Hold the physical delete open after the deleting tombstone has committed.
  const lateReferenceSource = await createStatusSource(cleanup, "late-reference");
  const tombstonePath = ownedPath();
  cleanup.paths!.push(tombstonePath);
  await registerEvidenceUploadIntent({ objectPath: tombstonePath });
  await ageObject(tombstonePath, { eligibleAt: daysAgo(31) });
  storage.seed(tombstonePath);
  storage.delayDeletes();
  const dryRun = await runEvidenceGcDryRun({ limit: 2 });
  cleanup.runIds?.push(dryRun.runId);
  const deletingPromise = applyEvidenceGc({
    dryRunId: dryRun.runId,
    storage,
    limit: 2,
  });
  await storage.waitForDeleteStart();
  await assert.rejects(
    prisma.spaceChecklistStatus.update({
      where: { id: lateReferenceSource.status.id },
      data: { photoUrl: tombstonePath },
    }),
    /Evidence object .* unavailable|constraint failed/i,
  );
  assert.equal(
    await prisma.spaceChecklistStatus.findUniqueOrThrow({
      where: { id: lateReferenceSource.status.id },
      select: { photoUrl: true },
    }).then((status) => status.photoUrl),
    null,
  );
  storage.releaseDeletes();
  const deleting = await deletingPromise;
  cleanup.runIds?.push(deleting.runId);
  assert.equal(storage.objects.has(tombstonePath), false);
});

test("storage failure, not-found, and worker crash remain retryable", async (t) => {
  await ensureEvidenceGcSchema();
  const cleanup: Cleanup = { paths: [] };
  t.after(() => cleanupFixture(cleanup));

  const failedPath = ownedPath();
  const notFoundPath = ownedPath();
  const crashedPath = ownedPath();
  cleanup.paths!.push(failedPath, notFoundPath, crashedPath);
  await Promise.all(
    [failedPath, notFoundPath, crashedPath].map((path) =>
      registerEvidenceUploadIntent({ objectPath: path }),
    ),
  );
  await Promise.all(
    [failedPath, notFoundPath, crashedPath].map((path) =>
      ageObject(path, { eligibleAt: daysAgo(31) }),
    ),
  );

  const storage = new ControlledEvidenceStorage();
  storage.seed(failedPath);
  storage.seed(notFoundPath);
  storage.seed(crashedPath);
  storage.setDeleteOutcome("failure");
  const failed = await applyAfterDryRun(cleanup, storage, { limit: 3 });
  assert.equal(failed.result.failedCount, 3);
  for (const path of [failedPath, notFoundPath, crashedPath]) {
    assert.deepEqual(
      await prisma.evidenceObject.findUniqueOrThrow({
        where: { objectPath: path },
        select: { state: true, deletionLeaseUntil: true, deleteAttempts: true },
      }).then((row) => ({
        state: row.state,
        lease: row.deletionLeaseUntil,
        attempts: row.deleteAttempts,
      })),
      { state: "deleting", lease: null, attempts: 1 },
    );
  }
  // Retry selection is intentionally bounded. Make its order deterministic
  // instead of relying on UUID ordering when each first claim shares a clock
  // tick.
  await prisma.evidenceObject.update({
    where: { objectPath: notFoundPath },
    data: { deletingAt: daysAgo(3) },
  });
  await prisma.evidenceObject.update({
    where: { objectPath: crashedPath },
    data: { deletingAt: daysAgo(2) },
  });
  await prisma.evidenceObject.update({
    where: { objectPath: failedPath },
    data: { deletingAt: daysAgo(1) },
  });

  storage.setDeleteOutcome("not-found");
  const notFoundRetry = await applyAfterDryRun(cleanup, storage, { limit: 1 });
  assert.equal(notFoundRetry.result.deletedCount, 1);
  assert.equal(
    await prisma.evidenceObject.findUniqueOrThrow({
      where: { objectPath: failedPath },
      select: { state: true },
    }).then((row) => row.state),
    "deleting",
  );

  storage.setDeleteOutcome("crash");
  const crashRetry = await applyAfterDryRun(cleanup, storage, { limit: 1 });
  assert.equal(crashRetry.result.failedCount, 1);
  storage.setDeleteOutcome("deleted");
  const finalRetry = await applyAfterDryRun(cleanup, storage, { limit: 2 });
  assert.equal(finalRetry.result.deletedCount, 2);
  const finalObjects = await prisma.evidenceObject.findMany({
    where: { objectPath: { in: [failedPath, notFoundPath, crashedPath] } },
    select: { state: true, deleteAttempts: true },
  });
  assert.deepEqual(
    finalObjects.map((object) => object.state),
    ["deleted", "deleted", "deleted"],
  );
  assert.deepEqual(
    finalObjects.map((object) => object.deleteAttempts).sort((a, b) => a - b),
    [2, 2, 3],
  );
});

test("audit finalization rolls back atomically and leaves a deleting object retryable", async (t) => {
  await ensureEvidenceGcSchema();
  const cleanup: Cleanup = { paths: [] };
  t.after(() => cleanupFixture(cleanup));

  const path = ownedPath();
  cleanup.paths!.push(path);
  await registerEvidenceUploadIntent({ objectPath: path });
  await ageObject(path, { eligibleAt: daysAgo(31) });

  const storage = new ControlledEvidenceStorage();
  storage.seed(path, "audit-rollback");
  const dryRun = await runEvidenceGcDryRun({ limit: 1 });
  cleanup.runIds ??= [];
  cleanup.runIds.push(dryRun.runId);

  await assert.rejects(
    withEvidenceGcAttemptAuditFailure(() =>
      applyEvidenceGc({
        dryRunId: dryRun.runId,
        storage,
        limit: 1,
      }),
    ),
    /controlled evidence GC audit update failure/,
  );
  const applyRun = await prisma.evidenceGcRun.findFirstOrThrow({
    where: { dryRunId: dryRun.runId },
    orderBy: { startedAt: "desc" },
  });
  cleanup.runIds.push(applyRun.id);
  const unresolvedAttempt = await prisma.evidenceGcAttempt.findUniqueOrThrow({
    where: { runId_objectId: { runId: applyRun.id, objectId: (
      await prisma.evidenceObject.findUniqueOrThrow({
        where: { objectPath: path },
        select: { id: true },
      })
    ).id } },
  });
  const unresolvedObject = await prisma.evidenceObject.findUniqueOrThrow({
    where: { objectPath: path },
    select: {
      state: true,
      deletedAt: true,
      deletionLeaseUntil: true,
      deleteAttempts: true,
    },
  });
  assert.equal(unresolvedObject.state, "deleting");
  assert.equal(unresolvedObject.deletedAt, null);
  assert(unresolvedObject.deletionLeaseUntil);
  assert.equal(unresolvedObject.deleteAttempts, 1);
  assert.equal(unresolvedAttempt.outcome, "claimed");
  assert.equal(unresolvedAttempt.attemptCount, 1);
  assert.equal(applyRun.deletedCount, 0);
  assert.equal(applyRun.failedCount, 0);
  assert.equal(applyRun.skippedCount, 0);
  assert.equal(storage.objects.has(path), false, "storage IO happened before audit failure");

  // A later operator run can reclaim the unresolved claim once its lease is
  // released. The same fake storage models an idempotent not-found retry.
  await prisma.evidenceObject.update({
    where: { objectPath: path },
    data: { deletionLeaseUntil: null },
  });
  const retryDryRun = await runEvidenceGcDryRun({ limit: 1 });
  cleanup.runIds.push(retryDryRun.runId);
  const retry = await applyEvidenceGc({
    dryRunId: retryDryRun.runId,
    storage,
    limit: 1,
  });
  cleanup.runIds.push(retry.runId);
  assert.equal(retry.deletedCount, 1);
  assert.equal(retry.failedCount, 0);
  const retryRun = await prisma.evidenceGcRun.findUniqueOrThrow({
    where: { id: retry.runId },
    include: { attempts: true },
  });
  assert.equal(retryRun.deletedCount, retry.deletedCount);
  assert.equal(retryRun.failedCount, retry.failedCount);
  assert.equal(retryRun.skippedCount, retry.skippedCount);
  assert.equal(retryRun.attempts[0]?.outcome, "deleted");
  assert.equal(
    await prisma.evidenceObject.findUniqueOrThrow({
      where: { objectPath: path },
      select: { state: true },
    }).then((object) => object.state),
    "deleted",
  );
});

test("a no-op apply reports and durably records zero skipped objects", async (t) => {
  await ensureEvidenceGcSchema();
  const cleanup: Cleanup = { paths: [] };
  t.after(() => cleanupFixture(cleanup));

  const path = ownedPath();
  cleanup.paths!.push(path);
  await registerEvidenceUploadIntent({ objectPath: path });
  await ageObject(path);
  const { result } = await applyAfterDryRun(cleanup, new ControlledEvidenceStorage(), {
    limit: 1,
  });
  assert.equal(result.newlyEligibleCount, 1);
  assert.equal(result.markedDeleting, 0);
  assert.equal(result.deletedCount, 0);
  assert.equal(result.failedCount, 0);
  assert.equal(result.skippedCount, 0);

  const durable = await prisma.evidenceGcRun.findUniqueOrThrow({
    where: { id: result.runId },
    select: {
      deletedCount: true,
      failedCount: true,
      skippedCount: true,
      markedDeleting: true,
      markedEligible: true,
      dryRunId: true,
    },
  });
  assert.equal(durable.deletedCount, result.deletedCount);
  assert.equal(durable.failedCount, result.failedCount);
  assert.equal(durable.skippedCount, 0);
  assert.equal(durable.markedDeleting, result.markedDeleting);
  assert.equal(durable.markedEligible, result.newlyEligibleCount);
  assert.equal(durable.dryRunId, cleanup.runIds![0]);
  const consumedPreview = await prisma.evidenceGcRun.findUniqueOrThrow({
    where: { id: cleanup.runIds![0] },
    select: { consumedAt: true, consumedByRunId: true },
  });
  assert(consumedPreview.consumedAt);
  assert.equal(consumedPreview.consumedByRunId, result.runId);
});

test("dry-run previews expire, are consumed once, preserve lineage, and serialize concurrent apply", async (t) => {
  await ensureEvidenceGcSchema();
  const cleanup: Cleanup = { runIds: [] };
  t.after(() => cleanupFixture(cleanup));

  const expired = await runEvidenceGcDryRun({ limit: 1 });
  cleanup.runIds!.push(expired.runId);
  await prisma.evidenceGcRun.update({
    where: { id: expired.runId },
    data: { dryRunExpiresAt: new Date(Date.now() - DAY_MS) },
  });
  await assert.rejects(
    applyEvidenceGc({
      dryRunId: expired.runId,
      storage: new ControlledEvidenceStorage(),
      limit: 1,
    }),
    /dry-run has expired/,
  );
  assert.equal(
    await prisma.evidenceGcRun.findUniqueOrThrow({
      where: { id: expired.runId },
      select: { consumedAt: true },
    }).then((run) => run.consumedAt),
    null,
  );

  const reusable = await runEvidenceGcDryRun({ limit: 1 });
  cleanup.runIds!.push(reusable.runId);
  const firstApply = await applyEvidenceGc({
    dryRunId: reusable.runId,
    storage: new ControlledEvidenceStorage(),
    limit: 1,
  });
  cleanup.runIds!.push(firstApply.runId);
  const lineage = await prisma.evidenceGcRun.findUniqueOrThrow({
    where: { id: reusable.runId },
    select: { consumedAt: true, consumedByRunId: true },
  });
  assert(lineage.consumedAt);
  assert.equal(lineage.consumedByRunId, firstApply.runId);
  assert.equal(
    await prisma.evidenceGcRun.findUniqueOrThrow({
      where: { id: firstApply.runId },
      select: { dryRunId: true },
    }).then((run) => run.dryRunId),
    reusable.runId,
  );
  await assert.rejects(
    applyEvidenceGc({
      dryRunId: reusable.runId,
      storage: new ControlledEvidenceStorage(),
      limit: 1,
    }),
    /dry-run has already been consumed/,
  );

  const concurrentPreview = await runEvidenceGcDryRun({ limit: 1 });
  cleanup.runIds!.push(concurrentPreview.runId);
  const concurrent = await Promise.allSettled([
    applyEvidenceGc({
      dryRunId: concurrentPreview.runId,
      storage: new ControlledEvidenceStorage(),
      limit: 1,
    }),
    applyEvidenceGc({
      dryRunId: concurrentPreview.runId,
      storage: new ControlledEvidenceStorage(),
      limit: 1,
    }),
  ]);
  const fulfilled = concurrent.filter(
    (outcome): outcome is PromiseFulfilledResult<EvidenceGcApplyResult> =>
      outcome.status === "fulfilled",
  );
  const rejected = concurrent.filter((outcome) => outcome.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(String(rejected[0]?.reason), /dry-run has already been consumed/);
  if (fulfilled[0]) cleanup.runIds!.push(fulfilled[0].value.runId);
  const consumedConcurrent = await prisma.evidenceGcRun.findUniqueOrThrow({
    where: { id: concurrentPreview.runId },
    select: { consumedByRunId: true },
  });
  assert.equal(consumedConcurrent.consumedByRunId, fulfilled[0]?.value.runId);
});

test("dry-run is read-only and selection remains bounded; abandoned uploads retain metadata", async (t) => {
  await ensureEvidenceGcSchema();
  const cleanup: Cleanup = { paths: [], runIds: [] };
  t.after(() => cleanupFixture(cleanup));

  const uploadPath = ownedPath();
  const oldPathA = ownedPath();
  const oldPathB = ownedPath();
  cleanup.paths!.push(uploadPath, oldPathA, oldPathB);
  const uploaded = await registerEvidenceUploadIntent({
    objectPath: `${uploadPath}#upload`,
    contentType: "video/mp4",
    sizeBytes: 2048,
    originalName: "abandoned.mp4",
    requestedByUserId: "upload-fixture-user",
  });
  const duplicate = await registerEvidenceUploadIntent({
    objectPath: uploadPath,
    contentType: "video/quicktime",
    sizeBytes: 4096,
    originalName: "renamed.mov",
  });
  assert.equal(uploaded.id, duplicate.id);
  assert.equal(duplicate.objectPath, uploadPath);
  assert.equal(duplicate.contentType, "video/quicktime");
  assert.equal(duplicate.sizeBytes, 4096);
  assert.equal(duplicate.originalName, "renamed.mov");
  assert(duplicate.retentionUntil.getTime() >= Date.now() + 29 * DAY_MS);

  await Promise.all([
    registerEvidenceUploadIntent({ objectPath: oldPathA }),
    registerEvidenceUploadIntent({ objectPath: oldPathB }),
  ]);
  await Promise.all([
    ageObject(oldPathA, { eligibleAt: daysAgo(31) }),
    ageObject(oldPathB, { eligibleAt: daysAgo(31) }),
  ]);
  const before = await prisma.evidenceObject.findMany({
    where: { objectPath: { in: [uploadPath, oldPathA, oldPathB] } },
    select: { objectPath: true, state: true, eligibleAt: true },
    orderBy: { objectPath: "asc" },
  });

  const storage = new ControlledEvidenceStorage();
  storage.seed(oldPathA);
  storage.seed(oldPathB);
  const dryRun = await runEvidenceGcDryRun({ limit: 1 });
  cleanup.runIds!.push(dryRun.runId);
  assert.equal(dryRun.requestedLimit, 1);
  assert(dryRun.examinedCount <= 1, "dry-run must never examine beyond its bound");
  assert.equal(storage.deleteCalls.length, 0);
  assert.deepEqual(
    await prisma.evidenceObject.findMany({
      where: { objectPath: { in: [uploadPath, oldPathA, oldPathB] } },
      select: { objectPath: true, state: true, eligibleAt: true },
      orderBy: { objectPath: "asc" },
    }),
    before,
  );
  assert.equal(
    await prisma.evidenceGcRun.findUniqueOrThrow({
      where: { id: dryRun.runId },
      select: { mode: true, status: true },
    }).then((run) => `${run.mode}:${run.status}`),
    "dry_run:complete",
  );
});

test("a concurrent reference committed behind the candidate lock prevents eligibility marking", async (t) => {
  await ensureEvidenceGcSchema();
  const cleanup: Cleanup = { paths: [] };
  t.after(() => cleanupFixture(cleanup));

  const path = ownedPath();
  cleanup.paths!.push(path);
  await registerEvidenceUploadIntent({ objectPath: path });
  await ageObject(path);
  const source = await createStatusSource(cleanup, "candidate-race");

  let releaseReference!: () => void;
  const referenceRelease = new Promise<void>((resolve) => {
    releaseReference = resolve;
  });
  let referenceUpdated!: () => void;
  const referenceStarted = new Promise<void>((resolve) => {
    referenceUpdated = resolve;
  });

  // The trigger locks the canonical inventory row before its source
  // transaction can commit. GC's FOR UPDATE SKIP LOCKED must therefore not
  // mark a candidate from its earlier READ COMMITTED snapshot.
  const referenceTransaction = prisma.$transaction(async (tx) => {
    await tx.spaceChecklistStatus.update({
      where: { id: source.status.id },
      data: { photoUrl: path, photoContentType: "image/jpeg" },
    });
    referenceUpdated();
    await referenceRelease;
  });
  await referenceStarted;

  const dryRun = await runEvidenceGcDryRun({ limit: 1 });
  cleanup.runIds ??= [];
  cleanup.runIds.push(dryRun.runId);
  assert.equal(dryRun.examinedCount, 0);

  releaseReference();
  await referenceTransaction;

  const storage = new ControlledEvidenceStorage();
  storage.seed(path);
  const applied = await applyEvidenceGc({
    dryRunId: dryRun.runId,
    storage,
    limit: 1,
  });
  cleanup.runIds.push(applied.runId);
  assert.equal(applied.newlyEligibleCount, 0);
  assert.equal(applied.deletedCount, 0);
  assert.equal(storage.deleteCalls.length, 0);
  assert.deepEqual(
    await prisma.evidenceObject.findUniqueOrThrow({
      where: { objectPath: path },
      select: { state: true, eligibleAt: true },
    }),
    { state: "active", eligibleAt: null },
  );
  assert.equal(
    await prisma.evidenceObjectReference.count({
      where: { object: { objectPath: path } },
    }),
    1,
  );
});

test("recursive legacy metadata paths are canonical references", async (t) => {
  await ensureEvidenceGcSchema();
  const cleanup: Cleanup = { paths: [], snapshotIds: [] };
  t.after(() => cleanupFixture(cleanup));

  const updatePath = ownedPath();
  const snapshotPath = ownedPath();
  cleanup.paths!.push(updatePath, snapshotPath);
  await Promise.all([
    registerEvidenceUploadIntent({ objectPath: updatePath }),
    registerEvidenceUploadIntent({ objectPath: snapshotPath }),
  ]);
  const source = await createStatusSource(cleanup, "recursive");
  await prisma.universityUpdate.create({
    data: {
      universityId: source.university.id,
      authorName: "GC fixture",
      content: "nested legacy metadata",
      tags: [],
      imageUrl: JSON.stringify({ gallery: [[updatePath]] }),
    },
  });
  const snapshotId = `gc-snapshot-${randomUUID()}`;
  cleanup.snapshotIds!.push(snapshotId);
  await prisma.pendingReportSnapshot.create({
    data: {
      id: snapshotId,
      createdByUserId: "gc-fixture-user",
      createdByEmail: "gc-fixture@example.test",
      deliveryMode: "email",
      dataset: { report: { attachments: [{ nested: [snapshotPath] }] } },
      filename: "gc-fixture.json",
      snapshotHash: randomUUID(),
      idempotencyKey: randomUUID(),
      expiresAt: new Date(Date.now() + DAY_MS),
      idempotencyExpiresAt: new Date(Date.now() + DAY_MS),
    },
  });

  assert.deepEqual(
    await prisma.evidenceObjectReference.findMany({
      where: { object: { objectPath: { in: [updatePath, snapshotPath] } } },
      select: {
        sourceType: true,
        sourceField: true,
        object: { select: { objectPath: true } },
      },
      orderBy: [{ sourceType: "asc" }, { object: { objectPath: "asc" } }],
    }),
    [
      {
        sourceType: "pending_report_snapshot",
        sourceField: `dataset:${await md5Path(snapshotPath)}`,
        object: { objectPath: snapshotPath },
      },
      {
        sourceType: "university_update",
        sourceField: `image_url:${await md5Path(updatePath)}`,
        object: { objectPath: updatePath },
      },
    ],
  );
});

test("operator dry-run and run inspection routes are bounded and readonly", async (t) => {
  await ensureEvidenceGcSchema();
  const suffix = randomUUID();
  const admin = await prisma.user.create({
    data: {
      name: "Evidence GC operator fixture",
      email: `evidence-gc-operator-${suffix}@example.test`,
      passwordHash: "not-used",
      role: "admin",
    },
  });
  const app = express();
  app.use(express.json());
  app.use("/api", evidenceGcRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const authorization = `Bearer ${signToken({
    userId: admin.id,
    email: admin.email,
    role: admin.role,
    name: admin.name,
    zoneIds: [],
    universityIds: [],
  })}`;
  let runId: string | undefined;
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      ...init,
      headers: {
        authorization,
        "content-type": "application/json",
        ...init.headers,
      },
    });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (runId) {
      await prisma.evidenceGcRun.delete({ where: { id: runId } });
    }
    await prisma.user.delete({ where: { id: admin.id } });
  });

  const dryRunResponse = await request("/evidence-gc/dry-run", {
    method: "POST",
    body: JSON.stringify({ retentionDays: 30, limit: 1 }),
  });
  assert.equal(dryRunResponse.status, 200);
  const dryRun = await dryRunResponse.json() as {
    runId: string;
    mode: string;
    requestedLimit: number;
  };
  runId = dryRun.runId;
  assert.equal(dryRun.mode, "dry_run");
  assert.equal(dryRun.requestedLimit, 1);

  const inspectResponse = await request(`/evidence-gc/runs/${dryRun.runId}`);
  assert.equal(inspectResponse.status, 200);
  const inspected = await inspectResponse.json() as {
    mode: string;
    status: string;
    requestedLimit: number;
  };
  assert.deepEqual(
    {
      mode: inspected.mode,
      status: inspected.status,
      requestedLimit: inspected.requestedLimit,
    },
    { mode: "dry_run", status: "complete", requestedLimit: 1 },
  );

  const invalidResponse = await request("/evidence-gc/dry-run", {
    method: "POST",
    body: JSON.stringify({ retentionDays: 1, limit: 1 }),
  });
  assert.equal(invalidResponse.status, 400);
});

async function md5Path(value: string): Promise<string> {
  // Keep the expected trigger key independent of object ids and source rows.
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(value).digest("hex");
}
});