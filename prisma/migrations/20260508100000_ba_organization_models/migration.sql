-- Better-Auth Organization plugin tables (issue #118).
--
-- Adds the three tables the BA Prisma adapter requires when the
-- organization plugin is active: organization, member, invitation.
-- Also adds `active_organization_id` to sessions so the interceptor
-- can resolve the tenant from the session without requiring the
-- x-tenant-id header on every request.
--
-- IDs are TEXT (not UUID) to match BA's opaque-string id contract.
-- Existing Tenant UUIDs are cast to TEXT in the data-migration step
-- (20260508110000) so RLS/CASL tenantId references remain valid.

CREATE TABLE IF NOT EXISTS "organization" (
  "id"         TEXT PRIMARY KEY,
  "name"       TEXT NOT NULL,
  "slug"       TEXT UNIQUE,
  "logo"       TEXT,
  "created_at" TIMESTAMPTZ NOT NULL,
  "metadata"   TEXT
);

CREATE TABLE IF NOT EXISTS "member" (
  "id"              TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id"         UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role"            TEXT NOT NULL,
  "created_at"      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS "member_organization_id_idx" ON "member"("organization_id");
CREATE INDEX IF NOT EXISTS "member_user_id_idx" ON "member"("user_id");

CREATE TABLE IF NOT EXISTS "invitation" (
  "id"              TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "email"           TEXT NOT NULL,
  "role"            TEXT,
  "status"          TEXT NOT NULL,
  "expires_at"      TIMESTAMPTZ NOT NULL,
  "inviter_id"      UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "invitation_organization_id_idx" ON "invitation"("organization_id");

-- Extend sessions to carry the BA organization plugin's active-org id.
-- NULL means no org has been activated for this session.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "active_organization_id" TEXT;
