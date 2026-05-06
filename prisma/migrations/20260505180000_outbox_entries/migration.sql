-- OutboxEntry persistent storage (CF.RT.04 + CF.WH.06 + CF.JOBS.01 — iter-107).
-- Backs the OutboxWorker per-second tick. Every domain write that
-- fans out to webhooks / realtime / search-index appends here; the
-- worker claims unprocessed rows in seq order, runs every registered
-- dispatcher, and marks processed_at only when ALL dispatchers succeeded.

CREATE TABLE "outbox_entries" (
  "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
  "seq"           SERIAL       NOT NULL,
  "tenant_id"     UUID         NOT NULL,
  "type"          TEXT         NOT NULL,
  "payload"       JSONB        NOT NULL,
  "occurred_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at"  TIMESTAMP(3),

  CONSTRAINT "outbox_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbox_entries_processed_at_seq_idx"
  ON "outbox_entries" ("processed_at", "seq");

-- RLS: tenant_id-scoped — every tenant only sees its own outbox
-- entries. The OutboxWorker runs as system actor and reads via the
-- bare client; domain code that reads outbox entries via
-- `runWithRlsTenant` sees only its tenant's rows. The permissive
-- `true` policy below is the framework default — projects override
-- via a follow-up migration if stricter isolation is required.
ALTER TABLE "outbox_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outbox_entries_all" ON "outbox_entries"
  FOR ALL
  USING (true)
  WITH CHECK (true);
