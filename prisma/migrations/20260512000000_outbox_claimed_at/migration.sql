-- Add claimed_at column to outbox_entries.
--
-- `resetStaleSentinels` now compares against claimed_at (when the in-flight
-- sentinel was written) instead of occurred_at (when the event was enqueued).
-- This prevents double-dispatch for backlog events: an event enqueued 10 min
-- ago but claimed just now will not be reset by the 5-min stale-sentinel sweep
-- while the worker is still dispatching it (Finding 1 / round-8 review).
ALTER TABLE "outbox_entries" ADD COLUMN "claimed_at" TIMESTAMP(3);
