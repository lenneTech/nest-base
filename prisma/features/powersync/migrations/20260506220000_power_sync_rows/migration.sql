-- Iter-216 — CF.PS.04 deviation closure: durable backing store for
-- the `/powersync/crud` upload endpoint.
--
-- Background: the iter-pre-216 controller stored mutations in a
-- private in-process `Map<string, StoreRow>`. Process restart dropped
-- every offline-queued change. This migration ships the default
-- Prisma-backed `power_sync_rows` table so the controller persists
-- across restarts without requiring projects to define a domain-
-- specific schema first.
--
-- Loaded only when `FEATURE_POWERSYNC_ENABLED=true`. Domain modules
-- may override the binding with their own `PowerSyncStore` adapter
-- via the standard NestJS provider replacement.
--
-- Tenant isolation: composite PK `(tenant_id, type, id)` plus an RLS
-- policy filtering on `current_setting('app.tenant_id')`.

CREATE TABLE "power_sync_rows" (
  "tenant_id" UUID    NOT NULL,
  "type"      TEXT    NOT NULL,
  "id"        TEXT    NOT NULL,
  "data"      JSONB   NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "power_sync_rows_pkey" PRIMARY KEY ("tenant_id", "type", "id")
);

CREATE INDEX "power_sync_rows_tenant_type_updated_at_idx"
  ON "power_sync_rows" ("tenant_id", "type", "updated_at");

ALTER TABLE "power_sync_rows" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_power_sync_rows ON "power_sync_rows"
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
