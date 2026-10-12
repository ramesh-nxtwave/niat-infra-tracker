import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  isOwnedEvidenceObjectPath,
  ObjectStorageService,
  stripObjectPathMetadata,
} from "./objectStorage";
import { ensureEvidenceGcSchema } from "./evidenceGcSchema";

export { ensureEvidenceGcSchema } from "./evidenceGcSchema";

export const MIN_EVIDENCE_RETENTION_DAYS = 30;
export const DEFAULT_EVIDENCE_RETENTION_DAYS = 30;
export const MAX_EVIDENCE_GC_BATCH = 500;
const DELETE_LEASE_MS = 5 * 60 * 1000;
const DRY_RUN_EXPIRY_MS = 15 * 60 * 1000;

const OWNED_EVIDENCE_PATH =
  /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Convert an object URL accepted by an API client into the one canonical
 * registry key. Absolute URLs are accepted conservatively only when their
 * pathname is exactly the owned namespace; local/external paths in every other
 * namespace are not GC candidates.
 */
export function canonicalEvidenceObjectPath(rawPath: string | null | undefined): string | null {
  if (typeof rawPath !== "string") return null;
  const withoutMetadata = stripObjectPathMetadata(rawPath.trim());
  const path = withoutMetadata.startsWith("http://") || withoutMetadata.startsWith("https://")
    ? (() => {
        try {
          return new URL(withoutMetadata).pathname;
        } catch {
          return null;
        }
      })()
    : withoutMetadata;
  if (!path) return null;
  const match = path.match(/^\/objects\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? `/objects/uploads/${match[1].toLowerCase()}` : null;
}

export function isCanonicalEvidenceObjectPath(rawPath: string): boolean {
  return OWNED_EVIDENCE_PATH.test(rawPath);
}

export type EvidenceUploadIntent = {
  objectPath: string;
  contentType?: string;
  sizeBytes?: number;
  originalName?: string;
  requestedByUserId?: string;
};

export async function registerEvidenceUploadIntent(intent: EvidenceUploadIntent) {
  await ensureEvidenceGcSchema();
  const objectPath = canonicalEvidenceObjectPath(intent.objectPath);
  if (!objectPath) {
    throw new Error("Upload intent must use /objects/uploads/<uuid>");
  }
  const retentionUntil = new Date(Date.now() + MIN_EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return prisma.$transaction(async tx => {
    const existing = await tx.$queryRaw<{
      id: string;
      state: string;
      retention_until: Date;
    }[]>(
      Prisma.sql`SELECT id, state, retention_until FROM evidence_objects WHERE object_path = ${objectPath} FOR UPDATE`,
    );
    if (existing[0] && existing[0].state !== "active") {
      throw new Error("Evidence object is no longer available for upload");
    }
    if (existing[0]) {
      return tx.evidenceObject.update({
        where: { id: existing[0].id },
        data: {
          contentType: intent.contentType,
          sizeBytes: intent.sizeBytes,
          originalName: intent.originalName,
          requestedByUserId: intent.requestedByUserId,
          retentionUntil: existing[0].retention_until > retentionUntil
            ? existing[0].retention_until
            : retentionUntil,
        },
      });
    }
    return tx.evidenceObject.create({
      data: {
        objectPath,
        contentType: intent.contentType,
        sizeBytes: intent.sizeBytes,
        originalName: intent.originalName,
        requestedByUserId: intent.requestedByUserId,
        retentionUntil,
      },
    });
  });
}

type GcCandidate = {
  id: string;
  object_path: string;
  state: string;
  delete_attempts: number;
  deletion_token?: string | null;
};

function clampBatch(limit: number | undefined): number {
  if (!Number.isSafeInteger(limit) || !limit || limit < 1) return 100;
  return Math.min(limit, MAX_EVIDENCE_GC_BATCH);
}

function validateRetentionDays(days: number | undefined): number {
  const value = days ?? DEFAULT_EVIDENCE_RETENTION_DAYS;
  if (!Number.isSafeInteger(value) || value < MIN_EVIDENCE_RETENTION_DAYS || value > 3650) {
    throw new Error(`retentionDays must be an integer between ${MIN_EVIDENCE_RETENTION_DAYS} and 3650`);
  }
  return value;
}

/**
 * Candidate SELECTs use a bounded snapshot query for ordering. Recheck each
 * locked object in a fresh statement before changing it, because a concurrent
 * reference trigger may have committed after that SELECT's snapshot was taken.
 * The object lock held by the recheck also prevents the normal trigger path
 * from committing a reference between this check and the caller's update.
 */
async function retainRowsWithoutReferences(
  tx: Prisma.TransactionClient,
  rows: GcCandidate[],
): Promise<GcCandidate[]> {
  const retained: GcCandidate[] = [];
  for (const row of rows) {
    const current = await tx.$queryRaw<{ has_reference: boolean }[]>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM evidence_object_references ref
        WHERE ref.object_id = eo.id
      ) AS has_reference
      FROM evidence_objects eo
      WHERE eo.id = ${row.id}
      FOR UPDATE
    `);
    if (current[0] && !current[0].has_reference) {
      retained.push(row);
    }
  }
  return retained;
}

async function findNewlyEligibleCandidates(
  tx: Prisma.TransactionClient,
  now: Date,
  retentionDays: number,
  limit: number,
): Promise<GcCandidate[]> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const rows = await tx.$queryRaw<GcCandidate[]>(Prisma.sql`
    SELECT eo.id, eo.object_path, eo.state, eo.delete_attempts
    FROM evidence_objects eo
    WHERE eo.state = 'active'
      AND eo.created_at <= ${cutoff}
      AND eo.retention_until <= ${now}
      AND eo.eligible_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM evidence_object_references ref WHERE ref.object_id = eo.id
      )
    ORDER BY eo.retention_until ASC, eo.created_at ASC, eo.id ASC
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  `);
  return retainRowsWithoutReferences(tx, rows);
}

async function findDeleteCandidates(
  tx: Prisma.TransactionClient,
  now: Date,
  retentionDays: number,
  limit: number,
): Promise<GcCandidate[]> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const eligibleBefore = new Date(now.getTime() - MIN_EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const rows = await tx.$queryRaw<GcCandidate[]>(Prisma.sql`
    SELECT eo.id, eo.object_path, eo.state, eo.delete_attempts
    FROM evidence_objects eo
    WHERE eo.state = 'active'
      AND eo.created_at <= ${cutoff}
      AND eo.retention_until <= ${now}
      AND eo.eligible_at IS NOT NULL
      AND eo.eligible_at <= ${eligibleBefore}
      AND NOT EXISTS (
        SELECT 1 FROM evidence_object_references ref WHERE ref.object_id = eo.id
      )
    ORDER BY eo.eligible_at ASC, eo.retention_until ASC, eo.id ASC
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  `);
  return retainRowsWithoutReferences(tx, rows);
}

async function findRetryCandidates(
  tx: Prisma.TransactionClient,
  now: Date,
  limit: number,
): Promise<GcCandidate[]> {
  const rows = await tx.$queryRaw<GcCandidate[]>(Prisma.sql`
    SELECT eo.id, eo.object_path, eo.state, eo.delete_attempts, eo.deletion_token
    FROM evidence_objects eo
    WHERE eo.state = 'deleting'
      AND (eo.deletion_lease_until IS NULL OR eo.deletion_lease_until <= ${now})
      AND NOT EXISTS (
        SELECT 1 FROM evidence_object_references ref WHERE ref.object_id = eo.id
      )
    ORDER BY eo.deleting_at ASC NULLS FIRST, eo.id ASC
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  `);
  return retainRowsWithoutReferences(tx, rows);
}

async function countProtectedCandidates(
  tx: Prisma.TransactionClient,
  now: Date,
  retentionDays: number,
  limit: number,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const rows = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT count(*)::bigint AS count
    FROM (
      SELECT eo.id
      FROM evidence_objects eo
      WHERE eo.state = 'active'
        AND eo.created_at <= ${cutoff}
        AND eo.retention_until <= ${now}
        AND EXISTS (
          SELECT 1 FROM evidence_object_references ref WHERE ref.object_id = eo.id
        )
      LIMIT ${limit}
    ) protected
  `);
  return Number(rows[0]?.count ?? 0n);
}

type EvidenceGcSummary = {
  runId: string;
  retentionDays: number;
  requestedLimit: number;
  examinedCount: number;
  newlyEligibleCount: number;
  eligibleCount: number;
  retryableDeletingCount: number;
  protectedByReferenceCount: number;
};

export type EvidenceGcDryRun = EvidenceGcSummary & { mode: "dry_run" };

export async function runEvidenceGcDryRun(input: {
  actorUserId?: string;
  actorEmail?: string;
  retentionDays?: number;
  limit?: number;
}): Promise<EvidenceGcDryRun> {
  await ensureEvidenceGcSchema();
  const retentionDays = validateRetentionDays(input.retentionDays);
  const requestedLimit = clampBatch(input.limit);
  const now = new Date();
  return prisma.$transaction(async tx => {
    const newlyEligible = await findNewlyEligibleCandidates(
      tx,
      now,
      retentionDays,
      requestedLimit,
    );
    const eligible = await findDeleteCandidates(
      tx,
      now,
      retentionDays,
      Math.max(0, requestedLimit - newlyEligible.length),
    );
    const retryable = await findRetryCandidates(
      tx,
      now,
      Math.max(0, requestedLimit - newlyEligible.length - eligible.length),
    );
    const protectedCount = await countProtectedCandidates(
      tx,
      now,
      retentionDays,
      requestedLimit,
    );
    const run = await tx.evidenceGcRun.create({
      data: {
        mode: "dry_run",
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        retentionDays,
        requestedLimit,
        dryRunExpiresAt: new Date(now.getTime() + DRY_RUN_EXPIRY_MS),
        examinedCount: newlyEligible.length + eligible.length + retryable.length,
        eligibleCount: eligible.length,
        markedEligible: newlyEligible.length,
        retryableDeletingCount: retryable.length,
        protectedByReferenceCount: protectedCount,
        skippedCount: 0,
        status: "complete",
        finishedAt: now,
      },
    });
    return {
      runId: run.id,
      mode: "dry_run",
      retentionDays,
      requestedLimit,
      examinedCount: newlyEligible.length + eligible.length + retryable.length,
      newlyEligibleCount: newlyEligible.length,
      eligibleCount: eligible.length,
      retryableDeletingCount: retryable.length,
      protectedByReferenceCount: protectedCount,
    };
  }, { timeout: 120_000 });
}

export type EvidenceGcApplyResult = EvidenceGcSummary & {
  mode: "apply";
  markedDeleting: number;
  deletedCount: number;
  failedCount: number;
  skippedCount: number;
  status: string;
};

type ClaimedCandidate = GcCandidate & { deletion_token: string };

async function hasCurrentEvidenceReference(objectId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ has_reference: boolean }[]>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM evidence_object_references
      WHERE object_id = ${objectId}
    ) AS has_reference
  `);
  return rows[0]?.has_reference ?? false;
}

type CandidateOutcome = "deleted" | "failed" | "skipped";

async function finalizeCandidateOutcome(
  candidate: ClaimedCandidate,
  runId: string,
  outcome: CandidateOutcome,
  errorMessage?: string,
): Promise<CandidateOutcome> {
  return prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ state: string; deletion_token: string | null }[]>(
      Prisma.sql`SELECT state, deletion_token FROM evidence_objects WHERE id = ${candidate.id} FOR UPDATE`,
    );
    const ownsClaim = locked[0]?.state === "deleting" &&
      locked[0].deletion_token === candidate.deletion_token;
    if (outcome === "deleted" && ownsClaim) {
      await tx.evidenceObject.update({
        where: { id: candidate.id },
        data: {
          state: "deleted",
          deletedAt: new Date(),
          deletionLeaseUntil: null,
          deletionToken: null,
          lastDeleteError: null,
          updatedAt: new Date(),
        },
      });
    } else if (outcome === "failed" && ownsClaim) {
      await tx.evidenceObject.update({
        where: { id: candidate.id },
        data: {
          deletionLeaseUntil: null,
          lastDeleteError: errorMessage,
          updatedAt: new Date(),
        },
      });
    } else if (outcome === "skipped" && ownsClaim) {
      // Keep the deleting tombstone fail-closed. A later retry may only happen
      // after a reference disappears; never silently restore active.
      await tx.evidenceObject.update({
        where: { id: candidate.id },
        data: {
          deletionLeaseUntil: null,
          deletionToken: null,
          lastDeleteError: errorMessage,
          updatedAt: new Date(),
        },
      });
    }

    const actualOutcome = ownsClaim ? outcome : "skipped";
    await tx.evidenceGcAttempt.update({
      where: { runId_objectId: { runId, objectId: candidate.id } },
      data: { outcome: actualOutcome, errorMessage, finishedAt: new Date() },
    });
    await tx.evidenceGcRun.update({
      where: { id: runId },
      data: {
        deletedCount: actualOutcome === "deleted" ? { increment: 1 } : undefined,
        failedCount: actualOutcome === "failed" ? { increment: 1 } : undefined,
        skippedCount: actualOutcome === "skipped" ? { increment: 1 } : undefined,
      },
    });
    return actualOutcome;
  });
}

export async function applyEvidenceGc(input: {
  dryRunId: string;
  actorUserId?: string;
  actorEmail?: string;
  retentionDays?: number;
  limit?: number;
  storage?: ObjectStorageService;
}): Promise<EvidenceGcApplyResult> {
  await ensureEvidenceGcSchema();
  const retentionDays = validateRetentionDays(input.retentionDays);
  const requestedLimit = clampBatch(input.limit);
  const now = new Date();
  const claim = await prisma.$transaction(async tx => {
    const dryRunRows = await tx.$queryRaw<{
      id: string;
      mode: string;
      status: string;
      actor_user_id: string | null;
      actor_email: string | null;
      dry_run_expires_at: Date | null;
      consumed_at: Date | null;
      retention_days: number;
      requested_limit: number;
    }[]>(Prisma.sql`
      SELECT id, mode, status, actor_user_id, actor_email,
        dry_run_expires_at, consumed_at, retention_days, requested_limit
      FROM evidence_gc_runs
      WHERE id = ${input.dryRunId}
      FOR UPDATE
    `);
    const dryRun = dryRunRows[0];
    if (!dryRun || dryRun.mode !== "dry_run" || dryRun.status !== "complete") {
      throw new Error("apply requires a completed dry-run id");
    }
    if (dryRun.consumed_at) {
      throw new Error("dry-run has already been consumed by an apply run");
    }
    if (!dryRun.dry_run_expires_at || dryRun.dry_run_expires_at <= now) {
      throw new Error("dry-run has expired; run a new dry-run before applying");
    }
    if (dryRun.actor_user_id && dryRun.actor_user_id !== input.actorUserId) {
      throw new Error("apply actor does not match the dry-run actor");
    }
    if (!dryRun.actor_user_id && dryRun.actor_email &&
        dryRun.actor_email !== input.actorEmail) {
      throw new Error("apply actor does not match the dry-run actor");
    }
    if (dryRun.retention_days !== retentionDays || dryRun.requested_limit !== requestedLimit) {
      throw new Error("apply must use the same retentionDays and limit as its dry-run");
    }
    const run = await tx.evidenceGcRun.create({
      data: {
        mode: "apply",
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        dryRunId: dryRun.id,
        retentionDays,
        requestedLimit,
      },
    });
    await tx.evidenceGcRun.update({
      where: { id: dryRun.id },
      data: { consumedAt: now, consumedByRunId: run.id },
    });
    const newlyEligible = await findNewlyEligibleCandidates(tx, now, retentionDays, requestedLimit);
    for (const row of newlyEligible) {
      await tx.evidenceObject.update({
        where: { id: row.id },
        data: {
          eligibleAt: now,
          eligibilityReason: `unreferenced after ${retentionDays} day retention`,
          updatedAt: now,
        },
      });
    }
    const eligible = await findDeleteCandidates(
      tx,
      now,
      retentionDays,
      Math.max(0, requestedLimit - newlyEligible.length),
    );
    const retryable = await findRetryCandidates(
      tx,
      now,
      Math.max(0, requestedLimit - newlyEligible.length - eligible.length),
    );
    const protectedByReferenceCount = await countProtectedCandidates(
      tx,
      now,
      retentionDays,
      requestedLimit,
    );
    const claimed: ClaimedCandidate[] = [];
    for (const row of [...eligible, ...retryable]) {
      const token = randomUUID();
      const attempts = row.delete_attempts + 1;
      await tx.evidenceObject.update({
        where: { id: row.id },
        data: {
          state: "deleting",
          deletingAt: now,
          deletionLeaseUntil: new Date(now.getTime() + DELETE_LEASE_MS),
          deletionToken: token,
          deleteAttempts: attempts,
          lastDeleteError: null,
          updatedAt: now,
        },
      });
      await tx.evidenceGcAttempt.create({
        data: {
          runId: run.id,
          objectId: row.id,
          objectPath: row.object_path,
          outcome: "claimed",
          attemptCount: attempts,
        },
      });
      claimed.push({ ...row, deletion_token: token, delete_attempts: attempts });
    }
    await tx.evidenceGcRun.update({
      where: { id: run.id },
      data: {
        examinedCount: newlyEligible.length + eligible.length + retryable.length,
        eligibleCount: eligible.length,
        markedEligible: newlyEligible.length,
        markedDeleting: claimed.length,
        retryableDeletingCount: retryable.length,
        protectedByReferenceCount: protectedByReferenceCount,
        skippedCount: 0,
      },
    });
    return { run, newlyEligible, eligible, retryable, claimed, protectedByReferenceCount };
  }, { timeout: 120_000 });

  const storage = input.storage ?? new ObjectStorageService();
  for (const candidate of claim.claimed) {
    if (await hasCurrentEvidenceReference(candidate.id)) {
      // Keep the deleting tombstone fail-closed if a reference was inserted
      // out-of-band; do not restore active or touch physical storage.
      await finalizeCandidateOutcome(
        candidate,
        claim.run.id,
        "skipped",
        "Reference appeared before physical deletion",
      );
      continue;
    }

    let storageError: string | undefined;
    try {
      if (!isOwnedEvidenceObjectPath(candidate.object_path)) {
        throw new Error("Registry contained a path outside /objects/uploads/<uuid>");
      }
      await storage.deleteOwnedEvidenceObject(candidate.object_path);
    } catch (error) {
      storageError = String(error instanceof Error ? error.message : error).slice(0, 2000);
    }
    if (storageError) {
      // If this bookkeeping transaction fails, let the error escape. The
      // object remains deleting and its claimed attempt/run stay unresolved
      // for a safe, idempotent retry.
      await finalizeCandidateOutcome(candidate, claim.run.id, "failed", storageError);
    } else {
      // Object state, attempt outcome, and run counters commit atomically here.
      // A failure escapes without falsely completing the run.
      await finalizeCandidateOutcome(candidate, claim.run.id, "deleted");
    }
  }

  const finished = await prisma.evidenceGcRun.update({
    where: { id: claim.run.id },
    data: { status: "complete", finishedAt: new Date() },
  });
  return {
    runId: finished.id,
    mode: "apply",
    retentionDays,
    requestedLimit,
    examinedCount: finished.examinedCount,
    newlyEligibleCount: finished.markedEligible,
    eligibleCount: finished.eligibleCount,
    retryableDeletingCount: finished.retryableDeletingCount,
    protectedByReferenceCount: finished.protectedByReferenceCount,
    markedDeleting: finished.markedDeleting,
    deletedCount: finished.deletedCount,
    failedCount: finished.failedCount,
    skippedCount: finished.skippedCount,
    status: finished.status,
  };
}

export async function getEvidenceGcRun(runId: string) {
  await ensureEvidenceGcSchema();
  return prisma.evidenceGcRun.findUnique({
    where: { id: runId },
    include: { attempts: { orderBy: { startedAt: "asc" }, take: MAX_EVIDENCE_GC_BATCH } },
  });
}