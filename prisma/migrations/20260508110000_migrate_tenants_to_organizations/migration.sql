-- Data migration: Tenant/TenantMember → BA Organization/Member (issue #118).
--
-- Mirrors existing Tenant rows into the BA `organization` table and
-- existing TenantMember rows into the BA `member` table, preserving
-- the original UUIDs cast to TEXT. BA treats ids as opaque strings, so
-- the cast is safe and the RLS/CASL tenantId boundary is unchanged.
--
-- Both inserts are idempotent (ON CONFLICT DO NOTHING) so the migration
-- can be re-run safely against a DB that already has some org rows
-- (e.g. if the org plugin was enabled manually before this migration).

-- Migrate Tenant → organization
-- slug: lower-case, hyphens replacing non-alphanumeric runs.
INSERT INTO "organization" ("id", "name", "slug", "created_at")
SELECT
  id::text,
  name,
  lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')),
  created_at
FROM "tenants"
ON CONFLICT ("id") DO NOTHING;

-- Migrate TenantMember → member
-- BA member.user_id is TEXT; our user.id column is UUID — cast accordingly.
INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at")
SELECT
  id::text,
  tenant_id::text,
  user_id,
  role,
  created_at
FROM "tenant_members"
ON CONFLICT ("id") DO NOTHING;
