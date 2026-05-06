-- AuditLog migration (CF.AUD.* — PRD § Core Features § Audit).
-- Adds the audit_action enum + audit_log table that the audit
-- Prisma extension writes to on every opted-in CUD operation.

CREATE TYPE "audit_action" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE');

CREATE TABLE "audit_log" (
  "id"              UUID         NOT NULL,
  "tenant_id"       UUID         NOT NULL,
  "actor_user_id"   UUID,
  "target_model"    TEXT         NOT NULL,
  "target_id"       TEXT         NOT NULL,
  "action"          "audit_action" NOT NULL,
  "diff"            JSONB        NOT NULL,
  "metadata"        JSONB,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log" ("tenant_id", "created_at");
CREATE INDEX "audit_log_target_model_target_id_idx" ON "audit_log" ("target_model", "target_id");
CREATE INDEX "audit_log_actor_user_id_created_at_idx" ON "audit_log" ("actor_user_id", "created_at");

-- RLS: per-tenant isolation. The audit-log shows ONLY rows tagged
-- with the tenant the current request belongs to. The
-- multi-tenancy interceptor sets `app.tenant_id` per transaction;
-- this policy reads it back via current_setting().
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_tenant_isolation"
  ON "audit_log"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
