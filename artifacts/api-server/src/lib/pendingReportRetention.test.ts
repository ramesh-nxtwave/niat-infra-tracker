import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  ACCEPTED_REPORT_DATA_RETENTION_MS,
  PENDING_REPORT_CLEANUP_BATCH_SIZE,
  cleanupPendingReportSnapshots,
} from "./pendingReportRetention";
import {
  InMemoryPendingReportSnapshotStore,
  PendingReportError,
  PendingReportService,
  type PendingReportSnapshotStore,
} from "./pendingReport";

const now = new Date("2026-06-15T00:00:00.000Z");

type SnapshotInput = Parameters<PendingReportSnapshotStore["create"]>[0];
type IsolatedDb = Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;

type SnapshotRow = {
  id: string;
  state: string;
  dataset: Record<string, unknown>;
  dataset_pruned_at: Date | null;
  filename: string;
  snapshot_hash: string;
  idempotency_key: string;
  lease_token: string | null;
  lease_expires_at: Date | null;
  attempted_at: Date | null;
  attempt_count: number;
  provider_id: string | null;
  provider_accepted_at: Date | null;
  expires_at: Date;
  idempotency_expires_at: Date;
  created_by_user_id: string;
  created_by_email: string;
  delivery_mode: string;
  audit_recorded: boolean | null;
};

const dataset: SnapshotInput["dataset"] = {
  generatedAt: "2026-06-14T23:00:00.000Z",
  scope: { kind: "all-active-universities", universityCount: 1 },
  recipients: ["reports@example.test"],
  summary: { pendingItems: 1, blockers: 1, overdue: 0, universitiesWithoutChecklistData: 0 },
  universities: [{
    id: "university-1",
    name: "Retention University",
    checklistDataState: "available",
    counts: { pending: 1, blockers: 1, overdue: 0 },
    pendingItems: [{
      id: "status-1", space: "5.0 Lab", classroom: null, category: "Safety",
      item: "Fire extinguisher", status: "Blocker", isBlocker: true, isOverdue: false,
      targetDate: null, targetDateSource: null, remarks: "keep this receipt metadata",
    }],
  }],
};

function snapshot(
  id: string,
  overrides: Partial<SnapshotInput> = {},
): SnapshotInput {
  return {
    id,
    createdByUserId: "retention-admin",
    createdByEmail: "retention-admin@example.test",
    snapshotVersion: 2,
    deliveryMode: "demonstration",
    dataset,
    datasetPrunedAt: null,
    filename: "pending-work-report-2026-06-14.csv",
    snapshotHash: `hash-${id}`,
    idempotencyKey: `idempotency-${id}`,
    idempotencyExpiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
    state: "ready",
    leaseToken: null,
    leaseExpiresAt: null,
    attemptedAt: null,
    attemptCount: 0,
    providerId: null,
    providerAcceptedAt: null,
    auditRecorded: null,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1_000),
    ...overrides,
  };
}

async function insertSnapshots(db: IsolatedDb, snapshots: SnapshotInput[]) {
  const values = snapshots.map(row => Prisma.sql`(
    ${row.id},
    ${row.createdByUserId},
    ${row.createdByEmail},
    ${row.snapshotVersion},
    ${row.deliveryMode},
    ${JSON.stringify(row.dataset)}::jsonb,
    ${row.datasetPrunedAt ?? null},
    ${row.filename},
    ${row.snapshotHash},
    ${row.idempotencyKey},
    ${row.expiresAt},
    ${row.idempotencyExpiresAt},
    ${row.state},
    ${row.leaseToken},
    ${row.leaseExpiresAt},
    ${row.attemptedAt},
    ${row.attemptCount},
    ${row.providerId},
    ${row.providerAcceptedAt},
    ${row.auditRecorded},
    ${now},
    ${now}
  )`);
  await db.$executeRaw(Prisma.sql`
    INSERT INTO pending_report_snapshots (
      id, created_by_user_id, created_by_email, snapshot_version, delivery_mode,
      dataset, dataset_pruned_at, filename, snapshot_hash, idempotency_key,
      expires_at, idempotency_expires_at, state, lease_token, lease_expires_at,
      attempted_at, attempt_count, provider_id, provider_accepted_at,
      audit_recorded, created_at, updated_at
    ) VALUES ${Prisma.join(values)}
  `);
}

async function readSnapshots(db: IsolatedDb): Promise<SnapshotRow[]> {
  return db.$queryRaw<SnapshotRow[]>`
    SELECT id, state, dataset, dataset_pruned_at, filename, snapshot_hash,
           idempotency_key, lease_token, lease_expires_at, attempted_at,
           attempt_count, provider_id, provider_accepted_at, expires_at,
            idempotency_expires_at, created_by_user_id, created_by_email,
            delivery_mode, audit_recorded
    FROM pending_report_snapshots
    ORDER BY id
  `;
}

async function withIsolatedSnapshots<T>(callback: (db: IsolatedDb) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(
      "CREATE TEMP TABLE pending_report_snapshots (LIKE public.pending_report_snapshots INCLUDING ALL) ON COMMIT DROP",
    );
    return callback(tx);
  });
}

test("retention deletes only untouched expired previews and compacts eligible accepted receipts", async () => {
  const acceptedBefore = new Date(now.getTime() - ACCEPTED_REPORT_DATA_RETENTION_MS);
  const rows = [
    snapshot("expired-ready", { expiresAt: new Date(now.getTime() - 1) }),
    snapshot("attempted-ready", {
      expiresAt: new Date(now.getTime() - 2),
      attemptedAt: new Date(now.getTime() - 1_000),
      attemptCount: 1,
    }),
    snapshot("sending-future-lease", {
      state: "sending",
      expiresAt: new Date(now.getTime() - 3),
      leaseToken: "active-lease",
      leaseExpiresAt: new Date(now.getTime() + 1_000),
      attemptedAt: new Date(now.getTime() - 2_000),
      attemptCount: 1,
    }),
    snapshot("sending-expired-lease", {
      state: "sending",
      expiresAt: new Date(now.getTime() - 4),
      leaseToken: "expired-lease",
      leaseExpiresAt: new Date(now.getTime() - 1_000),
      attemptedAt: new Date(now.getTime() - 3_000),
      attemptCount: 1,
    }),
    snapshot("unknown-beyond-idempotency-window", {
      state: "unknown",
      expiresAt: new Date(now.getTime() - 5),
      idempotencyExpiresAt: new Date(now.getTime() - 1),
      leaseExpiresAt: new Date(now.getTime() - 1),
      attemptedAt: new Date(now.getTime() - 4_000),
      attemptCount: 1,
    }),
    snapshot("accepted-at-both-boundaries", {
      state: "accepted",
      expiresAt: new Date(now),
      idempotencyExpiresAt: new Date(now),
      providerId: "provider-boundary",
      providerAcceptedAt: acceptedBefore,
      auditRecorded: true,
    }),
    snapshot("accepted-within-thirty-days", {
      state: "accepted",
      expiresAt: new Date(now),
      idempotencyExpiresAt: new Date(now),
      providerId: "provider-recent",
      providerAcceptedAt: new Date(acceptedBefore.getTime() + 1),
    }),
    snapshot("accepted-idempotency-window-open", {
      state: "accepted",
      expiresAt: new Date(now),
      idempotencyExpiresAt: new Date(now.getTime() + 1),
      providerId: "provider-idempotency-open",
      providerAcceptedAt: new Date(acceptedBefore.getTime() - 1),
    }),
    snapshot("accepted-preview-not-expired", {
      state: "accepted",
      expiresAt: new Date(now.getTime() + 1),
      idempotencyExpiresAt: new Date(now),
      providerId: "provider-preview-open",
      providerAcceptedAt: new Date(acceptedBefore.getTime() - 1),
    }),
    snapshot("accepted-lease-protected", {
      state: "accepted",
      expiresAt: new Date(now),
      idempotencyExpiresAt: new Date(now),
      leaseToken: "stale-but-present-lease",
      leaseExpiresAt: new Date(now.getTime() - 1),
      providerId: "provider-leased",
      providerAcceptedAt: new Date(acceptedBefore.getTime() - 1),
    }),
  ];

  await withIsolatedSnapshots(async db => {
    await insertSnapshots(db, rows);
    const before = await readSnapshots(db);
    const result = await cleanupPendingReportSnapshots(db, now);
    assert.deepEqual(result, { deletedPreviews: 1, compactedReports: 1 });

    const retained = await readSnapshots(db);
    assert.deepEqual(retained.map(row => row.id), rows.slice(1).map(row => row.id).sort());
    for (const protectedRow of before.filter(row =>
      row.id !== "expired-ready" && row.id !== "accepted-at-both-boundaries")) {
      assert.deepEqual(retained.find(row => row.id === protectedRow.id), protectedRow,
        `cleanup must leave all recovery content and state intact for ${protectedRow.id}`);
    }

    const compacted = retained.find(row => row.id === "accepted-at-both-boundaries");
    assert.ok(compacted);
    assert.deepEqual(compacted.dataset.universities, []);
    assert.equal(compacted.dataset.generatedAt, dataset.generatedAt);
    assert.deepEqual(compacted.dataset.summary, dataset.summary);
    assert.deepEqual(compacted.dataset.recipients, dataset.recipients);
    assert.deepEqual(compacted.dataset.scope, dataset.scope);
    assert.equal(compacted.created_by_user_id, "retention-admin");
    assert.equal(compacted.created_by_email, "retention-admin@example.test");
    assert.equal(compacted.delivery_mode, "demonstration");
    assert.equal(compacted.audit_recorded, true);
    assert.equal(compacted.filename, "pending-work-report-2026-06-14.csv");
    assert.equal(compacted.snapshot_hash, "hash-accepted-at-both-boundaries");
    assert.equal(compacted.idempotency_key, "idempotency-accepted-at-both-boundaries");
    assert.equal(compacted.provider_id, "provider-boundary");
    assert.equal(compacted.dataset_pruned_at?.toISOString(), now.toISOString());
  });
});

test("retention is bounded, then idempotent once every eligible batch is processed", async () => {
  const ready = Array.from({ length: PENDING_REPORT_CLEANUP_BATCH_SIZE + 1 }, (_, index) =>
    snapshot(`ready-${String(index).padStart(3, "0")}`, {
      expiresAt: new Date(now.getTime() - (PENDING_REPORT_CLEANUP_BATCH_SIZE + 1 - index)),
    }));
  const accepted = Array.from({ length: PENDING_REPORT_CLEANUP_BATCH_SIZE + 1 }, (_, index) =>
    snapshot(`accepted-${String(index).padStart(3, "0")}`, {
      state: "accepted",
      expiresAt: new Date(now),
      idempotencyExpiresAt: new Date(now),
      providerId: `provider-${index}`,
      providerAcceptedAt: new Date(now.getTime() - ACCEPTED_REPORT_DATA_RETENTION_MS - index),
    }));

  await withIsolatedSnapshots(async db => {
    await insertSnapshots(db, [...ready, ...accepted]);

    const first = await cleanupPendingReportSnapshots(db, now);
    assert.deepEqual(first, {
      deletedPreviews: PENDING_REPORT_CLEANUP_BATCH_SIZE,
      compactedReports: PENDING_REPORT_CLEANUP_BATCH_SIZE,
    });
    assert.equal((await readSnapshots(db)).length, PENDING_REPORT_CLEANUP_BATCH_SIZE + 2);

    const second = await cleanupPendingReportSnapshots(db, now);
    assert.deepEqual(second, { deletedPreviews: 1, compactedReports: 1 });
    const afterSecond = await readSnapshots(db);
    assert.equal(afterSecond.length, PENDING_REPORT_CLEANUP_BATCH_SIZE + 1);
    assert.ok(afterSecond.every(row => row.state === "accepted"));
    assert.ok(afterSecond.every(row => row.dataset.universities instanceof Array &&
      row.dataset.universities.length === 0));

    const third = await cleanupPendingReportSnapshots(db, now);
    assert.deepEqual(third, { deletedPreviews: 0, compactedReports: 0 });
    assert.deepEqual(await readSnapshots(db), afterSecond);
  });
});

test("repeat confirmation of a pruned accepted receipt is read-only, authorized, and never calls a provider", async () => {
  const store = new InMemoryPendingReportSnapshotStore();
  const receipt = snapshot("pruned-receipt", {
    state: "accepted",
    dataset: { ...dataset, universities: [] },
    datasetPrunedAt: new Date(now.getTime() - ACCEPTED_REPORT_DATA_RETENTION_MS),
    snapshotHash: "corrupted-receipt-hash",
    providerId: "saved-provider-id",
    providerAcceptedAt: new Date(now.getTime() - ACCEPTED_REPORT_DATA_RETENTION_MS),
    expiresAt: new Date(now.getTime() - 10 * 60 * 1_000),
    idempotencyExpiresAt: new Date(now.getTime() - 10 * 60 * 1_000),
    auditRecorded: true,
  });
  await store.create(receipt);

  let providerCalls = 0;
  const service = new PendingReportService(
    { async activeUniversities() { return []; } },
    { async recordAccepted() { throw new Error("pruned receipt must not audit again"); } },
    () => ({
      mode: "demonstration" as const,
      message: "No provider call expected.",
      provider: {
        async send() {
          providerCalls++;
          throw new Error("provider call was not allowed");
        },
      },
    }),
    () => now,
    store,
  );

  const [accepted, repeated] = await Promise.all([
    service.confirm({
      previewId: receipt.id, confirmed: true, userId: receipt.createdByUserId, userEmail: receipt.createdByEmail,
    }),
    service.confirm({
      previewId: receipt.id, confirmed: true, userId: receipt.createdByUserId, userEmail: receipt.createdByEmail,
    }),
  ]);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.providerId, "saved-provider-id");
  assert.equal(accepted.auditRecorded, true);
  assert.deepEqual(repeated, accepted);
  assert.equal(providerCalls, 0);

  await assert.rejects(
    () => service.confirm({
      previewId: receipt.id, confirmed: true, userId: "different-admin", userEmail: "different@example.test",
    }),
    (error: unknown) => error instanceof PendingReportError && error.status === 403,
  );
  assert.equal(providerCalls, 0);

  const corruptedReady = snapshot("corrupted-pruned-ready", {
    datasetPrunedAt: new Date(now.getTime() - 1),
    snapshotHash: "corrupted-ready-hash",
    expiresAt: new Date(now.getTime() + 10 * 60 * 1_000),
  });
  await store.create(corruptedReady);
  await assert.rejects(
    () => service.confirm({
      previewId: corruptedReady.id, confirmed: true,
      userId: corruptedReady.createdByUserId, userEmail: corruptedReady.createdByEmail,
    }),
    (error: unknown) => error instanceof PendingReportError && error.status === 410 &&
      /detailed dataset has been retired/.test(error.message),
  );
  assert.equal(providerCalls, 0);
});