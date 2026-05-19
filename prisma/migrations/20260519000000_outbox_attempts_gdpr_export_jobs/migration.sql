-- Outbox dispatch attempt counter (multi-replica safe dead-letter guard).
ALTER TABLE "outbox_entries"
  ADD COLUMN IF NOT EXISTS "dispatch_attempt_count" INTEGER NOT NULL DEFAULT 0;

-- GDPR async export job persistence (multi-replica poll-safe).
CREATE TABLE IF NOT EXISTS "gdpr_export_jobs" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "user_id" UUID NOT NULL,
  "tenant_id" UUID,
  "status" TEXT NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "payload" JSONB,
  "error" TEXT,
  CONSTRAINT "gdpr_export_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "gdpr_export_jobs_user_id_idx" ON "gdpr_export_jobs"("user_id");

ALTER TABLE "gdpr_export_jobs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gdpr_export_jobs_all" ON "gdpr_export_jobs"
  USING (true)
  WITH CHECK (true);
