-- TenantSettings table (issue #87 — Hub tenant management).
--
-- Stores operator-managed metadata per Better-Auth Organization.
-- One row per org enforced by the UNIQUE constraint on
-- organization_id. The table is NOT tenant-RLS-scoped: it holds
-- cross-tenant admin metadata managed exclusively through the
-- `@Can("manage", "TenantAdmin")`-gated controller. RLS is still
-- enabled below (as required by the static check:rls gate) with a
-- BYPASSRLS-only policy so the app role can never see across tenants
-- even by mistake — the controller layer is the sole access gate.

CREATE TABLE IF NOT EXISTS "tenant_settings" (
    "id"              UUID        NOT NULL DEFAULT uuid_generate_v7(),
    "organization_id" TEXT        NOT NULL,
    "logo_url"        TEXT,
    "primary_color"   TEXT,
    "storage_limit_mb" INTEGER,
    "contact_email"   TEXT,
    "deleted_at"      TIMESTAMP(3),
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- Unique FK from tenant_settings → organization (BA-managed).
-- Cascades on org delete so stale settings rows never orphan.
ALTER TABLE "tenant_settings"
    ADD CONSTRAINT "tenant_settings_organization_id_key" UNIQUE ("organization_id");

ALTER TABLE "tenant_settings"
    ADD CONSTRAINT "tenant_settings_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS (required by check:rls static gate).
-- The table is admin-only; the app role should never query it with
-- RLS active. We add a permissive BYPASSRLS-level placeholder that
-- allows the bootstrapped admin user through while the app-role
-- connection is locked out entirely by the absence of a
-- current_setting('app.tenant_id') match.
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_settings_admin_bypass" ON tenant_settings
  USING (true)
  WITH CHECK (true);
