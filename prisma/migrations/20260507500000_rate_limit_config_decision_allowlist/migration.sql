-- Rate-limit admin tables (issue #94).
--
-- Three tables support the /admin/rate-limits Hub section:
--
--   rate_limit_configs   — operator-editable window overrides (scope, maxRequests, windowSeconds).
--   rate_limit_decisions — sampled decision log (blocks always; allows 1%).
--   rate_limit_allowlist — users exempt from throttling.
--
-- All use gen_random_uuid() so they work on Postgres 14+ without
-- the pgcrypto extension (gen_random_uuid() is built-in from Pg 13).

CREATE TABLE IF NOT EXISTS "rate_limit_configs" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "scope"          TEXT        NOT NULL,
  "max_requests"   INTEGER     NOT NULL,
  "window_seconds" INTEGER     NOT NULL,
  "updated_by_id"  UUID,
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "rate_limit_configs_pkey"   PRIMARY KEY ("id"),
  CONSTRAINT "rate_limit_configs_scope_key" UNIQUE ("scope")
);

CREATE TABLE IF NOT EXISTS "rate_limit_decisions" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "bucket_key"  TEXT        NOT NULL,
  "endpoint"    TEXT        NOT NULL,
  "decision"    TEXT        NOT NULL,
  "count"       INTEGER     NOT NULL,
  "limit"       INTEGER     NOT NULL,
  "window_secs" INTEGER     NOT NULL,
  "ip"          TEXT,
  "user_id"     UUID,
  "ts"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "rate_limit_decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "rate_limit_decisions_bucket_key_idx" ON "rate_limit_decisions" ("bucket_key");
CREATE INDEX IF NOT EXISTS "rate_limit_decisions_ts_idx"         ON "rate_limit_decisions" ("ts");

CREATE TABLE IF NOT EXISTS "rate_limit_allowlist" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "user_id"     UUID        NOT NULL,
  "reason"      TEXT        NOT NULL,
  "created_by_id" UUID,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "rate_limit_allowlist_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "rate_limit_allowlist_user_id_key" UNIQUE ("user_id")
);
