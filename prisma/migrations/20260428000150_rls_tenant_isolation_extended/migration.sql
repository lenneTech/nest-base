-- Tenant-isolation policies — extended coverage.
--
-- The original `20260428000100_rls_tenant_isolation` migration only
-- enabled RLS on `users` + `roles`. Every other tenant-scoped table
-- (with a `tenant_id` column) was left wide open, contradicting the
-- promise in `src/modules/CLAUDE.md`:
--
--   "the RLS policy on the table refuses foreign-tenant rows
--    automatically — even a forgotten `WHERE` clause can't leak
--    across tenants"
--
-- This migration brings RLS coverage up to that promise on every
-- tenant-scoped table that exists in the init schema. Same shape as
-- the earlier policy: `tenant_id = current_setting('app.tenant_id')`,
-- both as USING clause (read filter) and WITH CHECK (write filter),
-- so the BYPASSRLS bootstrap admin role still has free reign while
-- the application role is locked to the request-context tenant.
--
-- Adding a new tenant-scoped table later? Append a parallel block
-- here in a follow-up migration. There is intentionally no "loop
-- over information_schema" automation — RLS is a load-bearing
-- security layer, opt-in per table is the safer default.

ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenant_members ON tenant_members
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE file_blobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_file_blobs ON file_blobs
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_folders ON folders
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE files ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_files ON files
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_webhook_endpoints ON webhook_endpoints
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE examples ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_examples ON examples
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_user_profiles ON user_profiles
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
