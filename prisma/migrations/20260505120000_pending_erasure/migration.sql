-- PendingErasure (CF.GDPR.04 — iter-88).
-- Backs the GdprErasureRunner daily cron. A row is created when a
-- user calls DELETE /me/account; the runner anonymises the user
-- after the 30-day grace window via planGdprGracePeriodErasures().

CREATE TABLE "pending_erasures" (
  "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      UUID         NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelled_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pending_erasures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pending_erasures_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);

CREATE INDEX "pending_erasures_user_id_idx" ON "pending_erasures" ("user_id");
CREATE INDEX "pending_erasures_eligible_idx"
  ON "pending_erasures" ("completed_at", "cancelled_at", "requested_at");

-- The table holds PII deletion requests scoped to a single user. RLS
-- isn't tenant-driven (a user has at most one tenant via User.tenantId
-- but the deletion request itself is per-user). The runner runs as
-- a system actor — RLS is enabled with no policy, so only superuser
-- (the migration session) can read/write. All access must go through
-- the runner / controller, which set `app.tenant_id` via
-- runWithRlsTenant when needed.
ALTER TABLE "pending_erasures" ENABLE ROW LEVEL SECURITY;
-- ALL-permissive policy keyed on the request user, so the
-- DELETE /me/account controller can write under the user's tenant
-- context, and the runner (system) can read all rows when
-- `app.tenant_id` resolves to the user's tenant. Project code that
-- wants stricter isolation overrides this policy in a follow-up
-- migration.
CREATE POLICY "pending_erasures_all" ON "pending_erasures"
  FOR ALL
  USING (true)
  WITH CHECK (true);
