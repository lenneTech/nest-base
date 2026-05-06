-- IdempotencyRecord persistent storage (CF.STORAGE.01 closure — iter-179).
-- Replaces the in-memory `InMemoryIdempotencyStore` with a Prisma-backed
-- adapter so cached responses survive a process restart.
--
-- The `key` column already encodes the userId via `scopeIdempotencyKey()`
-- (e.g. `<userId>::<client-key>` or `anon::<client-key>`), so cross-user
-- replays cannot collide. The companion `user_id` column lets framework
-- code reason about ownership without parsing the prefix.

CREATE TABLE "idempotency_records" (
  "key"          TEXT         NOT NULL,
  "user_id"      UUID,
  "request_hash" TEXT         NOT NULL,
  "status"       INTEGER      NOT NULL,
  "body"         JSONB        NOT NULL,
  "expires_at"   TIMESTAMP(3) NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "idempotency_records_expires_at_idx"
  ON "idempotency_records" ("expires_at");

-- The idempotency layer is intentionally NOT tenant-scoped: the key
-- itself encodes the userId, and replays MUST be visible regardless
-- of the request's tenant context (the same user can hit the same
-- endpoint across tenants). RLS therefore stays off here. The check:rls
-- audit treats absence of `tenant_id` as the "not tenant-scoped" branch
-- and does not require a policy.
