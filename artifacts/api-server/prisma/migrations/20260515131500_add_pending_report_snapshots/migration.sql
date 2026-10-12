CREATE TABLE "pending_report_snapshots" (
  "id" TEXT NOT NULL,
  "created_by_user_id" TEXT NOT NULL,
  "created_by_email" TEXT NOT NULL,
  "snapshot_version" INTEGER NOT NULL DEFAULT 1,
  "delivery_mode" TEXT NOT NULL,
  "dataset" JSONB NOT NULL,
  "filename" TEXT NOT NULL,
  "snapshot_hash" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "idempotency_expires_at" TIMESTAMP(3) NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'ready',
  "lease_token" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "attempted_at" TIMESTAMP(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "provider_id" TEXT,
  "provider_accepted_at" TIMESTAMP(3),
  "audit_recorded" BOOLEAN,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pending_report_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_report_snapshots_idempotency_key_key"
  ON "pending_report_snapshots"("idempotency_key");
CREATE INDEX "pending_report_snapshots_state_lease_expires_at_idx"
  ON "pending_report_snapshots"("state", "lease_expires_at");
CREATE INDEX "pending_report_snapshots_expires_at_idx"
  ON "pending_report_snapshots"("expires_at");
CREATE INDEX "pending_report_snapshots_idempotency_expires_at_idx"
  ON "pending_report_snapshots"("idempotency_expires_at");
CREATE INDEX "pending_report_snapshots_created_by_user_id_created_at_idx"
  ON "pending_report_snapshots"("created_by_user_id", "created_at");