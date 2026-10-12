import type { Prisma } from "@prisma/client";

// Keep reviewed content for 30 days after acceptance AND beyond the provider's
// deduplication window. Unresolved outcomes have no automatic retention limit:
// elapsed time alone is not evidence that an email was not accepted.
export const ACCEPTED_REPORT_DATA_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const PENDING_REPORT_CLEANUP_BATCH_SIZE = 100;

/**
 * Run on manual preview creation, never on the report scheduler. Each statement
 * locks at most one batch and skips rows another worker is changing. The
 * eligibility check and mutation share a statement/row lock so confirmation
 * cannot claim a ready row between selection and deletion.
 *
 * Accepted receipts retain identity, ownership, recipients, scope, summary,
 * original content hash, provider acceptance, audit status and idempotency key.
 * They are never deleted or used to reconstruct a provider request.
 */
export async function cleanupPendingReportSnapshots(
  db: Pick<Prisma.TransactionClient, "$executeRaw">,
  now = new Date(),
): Promise<{ deletedPreviews: number; compactedReports: number }> {
  const acceptedBefore = new Date(now.getTime() - ACCEPTED_REPORT_DATA_RETENTION_MS);
  const deletedPreviews = await db.$executeRaw`
    WITH candidates AS (
      SELECT id FROM pending_report_snapshots
      WHERE state = 'ready' AND expires_at <= ${now}
        AND attempted_at IS NULL AND attempt_count = 0
        AND lease_token IS NULL AND lease_expires_at IS NULL
        AND provider_id IS NULL AND provider_accepted_at IS NULL
      ORDER BY expires_at, id
      LIMIT ${PENDING_REPORT_CLEANUP_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM pending_report_snapshots AS snapshot
    USING candidates WHERE snapshot.id = candidates.id
  `;
  const compactedReports = await db.$executeRaw`
    WITH candidates AS (
      SELECT id FROM pending_report_snapshots
      WHERE state = 'accepted' AND dataset_pruned_at IS NULL
        AND provider_id IS NOT NULL AND provider_accepted_at <= ${acceptedBefore}
        AND idempotency_expires_at <= ${now}
        AND expires_at <= ${now}
        AND lease_token IS NULL AND lease_expires_at IS NULL
      ORDER BY provider_accepted_at, id
      LIMIT ${PENDING_REPORT_CLEANUP_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE pending_report_snapshots AS snapshot
    SET dataset = jsonb_set(snapshot.dataset, '{universities}', '[]'::jsonb),
        dataset_pruned_at = ${now}, updated_at = ${now}
    FROM candidates WHERE snapshot.id = candidates.id
  `;
  return { deletedPreviews, compactedReports };
}