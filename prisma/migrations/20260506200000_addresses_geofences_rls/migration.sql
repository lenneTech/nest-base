-- Iter-204 reviewer-G1 closure: enable RLS on `addresses` and
-- `geofences`. Both tables ship from `prisma/features/geo.prisma`
-- and carry a nullable `"tenantId"` column (camelCase, unquoted in
-- Prisma's @schema concat output). The geo migration in
-- 20260428000250_geo_schema added the columns + indexes but never
-- enabled RLS — the static `check:rls` audit stayed silent only
-- because the schema is feature-gated and tests run with the geo
-- feature off by default. With the iter-204 reviewer's G1 finding,
-- the gap is now closed.
--
-- Policy shape mirrors the canonical pattern from the original
-- `20260428000150_rls_tenant_isolation_extended` migration:
-- `"tenantId" = current_setting('app.tenant_id')` on both USING
-- (read filter) and WITH CHECK (write filter). Bootstrap roles with
-- BYPASSRLS retain unrestricted access; the application role is
-- locked to the request-context tenant.
--
-- The column is nullable, so we coalesce a NULL `tenantId` to a
-- sentinel that can never match any UUID — this preserves the
-- existing fallback semantic ("address with no tenant") while
-- still refusing to leak null-tenant rows across operator scopes.

ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_addresses ON addresses
  USING (
    coalesce("tenantId"::text, '00000000-0000-0000-0000-000000000000')
      = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    coalesce("tenantId"::text, '00000000-0000-0000-0000-000000000000')
      = current_setting('app.tenant_id', true)
  );

ALTER TABLE geofences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_geofences ON geofences
  USING (
    coalesce("tenantId"::text, '00000000-0000-0000-0000-000000000000')
      = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    coalesce("tenantId"::text, '00000000-0000-0000-0000-000000000000')
      = current_setting('app.tenant_id', true)
  );
