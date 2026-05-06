-- Throttler-records table (CF.SEC.RATE_LIMIT).
-- Backs `PostgresThrottlerBackend` — the @nestjs/throttler-compatible
-- storage adapter that turns rate-limit decisions cross-instance.
--
-- Each row records the cumulative request count for a particular
-- (route × bucket × tenant?) key plus the wall-clock instant the
-- current window expires. The backend's atomic upsert handles
-- both the increment-existing and reset-on-expired branches in a
-- single SQL statement so concurrent requests never race.
--
-- The table is intentionally simple — no FK back to users / tenants:
--   - the key encodes the bucket scope at the request handler level
--   - rate-limit data is ephemeral; tying it to a tenant FK would
--     force cascading deletes on tenant removal, which is the wrong
--     semantic (the tenant's leftover bucket counters should expire
--     naturally rather than vanish in a transaction)
--
-- Garbage collection: a periodic background sweep deletes rows whose
-- `expires_at < now() - INTERVAL '1 day'` — keeps the table bounded
-- without a CASCADE. The sweep runs on the same `JobsModule` cron
-- surface as the email-outbox worker; default cadence is 1 hour.

CREATE TABLE "throttler_records" (
  "key"        TEXT         NOT NULL,
  "count"      INTEGER      NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "throttler_records_pkey" PRIMARY KEY ("key")
);

-- Sweep-friendly index — `WHERE expires_at < now() - INTERVAL '1 day'`
-- runs in O(log n) rather than full-scan.
CREATE INDEX "throttler_records_expires_at_idx" ON "throttler_records" ("expires_at");
