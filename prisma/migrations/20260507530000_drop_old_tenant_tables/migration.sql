-- Drop the RLS policy on `users` that referenced `tenant_id` before
-- removing the column. The user isolation policy is now handled via
-- session.activeOrganizationId / the `member` table (issue #118).
DROP POLICY IF EXISTS "tenant_isolation_users" ON "users";

-- Remove FK that referenced old tenants table from users (if it exists)
ALTER TABLE "users" DROP COLUMN IF EXISTS "tenant_id";

-- Drop FK constraints that point to the tenants table so we can drop it.
ALTER TABLE "file_blobs" DROP CONSTRAINT IF EXISTS "file_blobs_tenant_id_fkey";
ALTER TABLE "folders" DROP CONSTRAINT IF EXISTS "folders_tenant_id_fkey";
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_tenant_id_fkey";
ALTER TABLE "webhook_endpoints" DROP CONSTRAINT IF EXISTS "webhook_endpoints_tenant_id_fkey";
ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "roles_tenant_id_fkey";

-- Drop old hand-rolled tables now that data is migrated to BA organization/member
DROP TABLE IF EXISTS "tenant_members";
DROP TABLE IF EXISTS "tenants";
DROP TYPE IF EXISTS "TenantMemberStatus";
