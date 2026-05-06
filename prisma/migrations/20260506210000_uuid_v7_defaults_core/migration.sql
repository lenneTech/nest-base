-- Iter-210 — CF.UUID.01 deviation closure: every core-model id column
-- gets a Postgres-side `uuid_generate_v7()` DEFAULT.
--
-- Background: every `@default(uuid())` in `prisma/schema.prisma` was
-- application-side — Prisma's client generates a UUID v4 BEFORE the
-- INSERT, so the column carried no DB-level default. The
-- `uuidV7Extension` (`src/core/repository/prisma-extensions.ts`)
-- intercepts every Prisma write to inject a v7 id, so production
-- writes already get v7. The mismatch was that:
--   1. `@default(uuid())` in the schema implied v4 to readers
--   2. raw-SQL inserts (migrations, manual SQL, `$queryRawUnsafe`)
--      that didn't go through the Prisma client got NO default and
--      had to provide an id explicitly
--
-- Iter-210 fixes both: every core model now declares
-- `@default(dbgenerated("uuid_generate_v7()"))` in `schema.prisma` so
-- Prisma emits `DEFAULT` in the INSERT and Postgres falls back to
-- this column-level default. Raw-SQL inserts also benefit because the
-- DB now provides a v7 id when the INSERT omits the id column.
--
-- The `pg_uuidv7` extension is enabled by `20260428000000_pg_uuidv7`
-- which runs ahead of every CREATE TABLE migration, so the function
-- is always available.
--
-- This migration is metadata-only — existing rows keep their v4 ids;
-- only newly-inserted rows get v7. Forward-only per
-- `docs/api-stability-promise.md`.

ALTER TABLE "_health_ping"        ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "tenants"             ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "tenant_members"      ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "users"               ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "sessions"            ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "accounts"            ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "verifications"       ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "jwks"                ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "two_factors"         ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "passkeys"            ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "api_keys"            ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "file_blobs"          ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "folders"             ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "files"               ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "webhook_endpoints"   ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "webhook_deliveries"  ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "email_outbox"        ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "roles"               ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "policies"            ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "permissions"         ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "examples"            ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "user_profiles"       ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "outbox_entries"      ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "pending_erasures"    ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
ALTER TABLE "audit_log"           ALTER COLUMN "id" SET DEFAULT uuid_generate_v7();
-- `idempotency_records` uses `key` (string scope) as PK; no `id` column.
-- `asset_variant_index` uses `cache_key` (string hash) as PK; no `id` column.
-- Both intentionally excluded from the v7-default flip.
