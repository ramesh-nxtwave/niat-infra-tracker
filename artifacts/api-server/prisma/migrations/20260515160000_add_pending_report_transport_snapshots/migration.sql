ALTER TABLE "pending_report_snapshots"
  ADD COLUMN "delivery_provider" TEXT,
  ADD COLUMN "sender_email" TEXT,
  ADD COLUMN "sender_name" TEXT;
