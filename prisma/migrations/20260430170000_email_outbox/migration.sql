-- Email-Outbox table (issue #11 — at-least-once email delivery).
--
-- Backs EmailOutboxRecorder + EmailOutboxWorker. Every record stores
-- the exact args of EmailService.send / sendTemplate as JSON so the
-- worker can replay them without re-running domain logic.
--
-- Idempotency: `idempotency_key` is unique-when-present, so two
-- hook-triggers within the same dedup window collapse to a single
-- row. Concurrency: `claimed_at` is set the moment a worker decides
-- to send; stale claims (> STALE_CLAIM_THRESHOLD_MS) are rescued by
-- the next tick (see email-outbox-planner.ts).

CREATE TYPE "EmailOutboxStatus" AS ENUM ('PENDING', 'SENT', 'DEAD_LETTER');
CREATE TYPE "EmailOutboxKind"   AS ENUM ('SEND', 'SEND_TEMPLATE');

CREATE TABLE "email_outbox" (
    "id"               UUID                NOT NULL,
    "kind"             "EmailOutboxKind"   NOT NULL,
    "payload"          JSONB               NOT NULL,
    "idempotency_key"  TEXT,
    "status"           "EmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count"    INTEGER             NOT NULL DEFAULT 0,
    "next_attempt_at"  TIMESTAMP(3),
    "claimed_at"       TIMESTAMP(3),
    "last_error"       TEXT,
    "succeeded_at"     TIMESTAMP(3),
    "failed_at"        TIMESTAMP(3),
    "created_at"       TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3)        NOT NULL,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- Unique-when-present: the index ignores NULLs by default. Two
-- pending rows with the same idempotency_key would violate this,
-- which is exactly the dedup guarantee Better-Auth needs.
CREATE UNIQUE INDEX "email_outbox_idempotency_key_key"
    ON "email_outbox"("idempotency_key");

-- Hot-path indexes for the worker tick.
CREATE INDEX "email_outbox_status_next_attempt_at_idx"
    ON "email_outbox"("status", "next_attempt_at");

CREATE INDEX "email_outbox_status_created_at_idx"
    ON "email_outbox"("status", "created_at");
