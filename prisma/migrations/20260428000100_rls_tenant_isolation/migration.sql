-- Tenant-isolation policies (PLAN.md §5 + §28.2/#8).
--
-- Every request stamps `app.tenant_id` via the Prisma extension. The
-- policies below filter every row read/written through the public
-- application role to the matching tenant. The bootstrap admin role
-- bypasses RLS via `BYPASSRLS` granted out-of-band.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_users ON users
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_roles ON roles
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
