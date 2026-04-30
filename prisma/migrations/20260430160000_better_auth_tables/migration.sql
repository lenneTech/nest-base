-- Better-Auth Prisma persistence (closes finding #1).
--
-- Adds the columns Better-Auth's user table requires plus the four
-- core tables (sessions / accounts / verifications) and the three
-- plugin tables (jwks / two_factors / passkeys). All tables stay
-- empty until the matching authMethod / plugin is toggled on, so a
-- single migration covers every feature-flag combination.
--
-- Existing rows: the `users` row provisioned by SystemSetupModule
-- bootstrap (or any prior seed run) gets `name = ''`,
-- `email_verified = false`, no `image`. The `tenant_id` column is
-- relaxed from NOT NULL to nullable so a Better-Auth signup can
-- create a user before tenant pre-pick happens. Existing
-- non-null values are preserved.

-- AlterTable: extend `users` with the Better-Auth required columns
ALTER TABLE "users"
    ADD COLUMN "name"            TEXT    NOT NULL DEFAULT '',
    ADD COLUMN "email_verified"  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "image"           TEXT,
    ADD COLUMN "two_factor_enabled" BOOLEAN;

-- Drop the existing FK first so we can relax NOT NULL on the column
-- without losing the relation when we re-create the constraint with
-- ON DELETE SET NULL semantics (matching the new Prisma `Tenant?`
-- relation).
ALTER TABLE "users" DROP CONSTRAINT "users_tenant_id_fkey";
ALTER TABLE "users" ALTER COLUMN "tenant_id" DROP NOT NULL;
ALTER TABLE "users"
    ADD CONSTRAINT "users_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: sessions
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: accounts
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: verifications
CREATE TABLE "verifications" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateTable: jwks (jwt plugin)
CREATE TABLE "jwks" (
    "id" UUID NOT NULL,
    "public_key" TEXT NOT NULL,
    "private_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "jwks_pkey" PRIMARY KEY ("id")
);

-- CreateTable: two_factors (twoFactor plugin)
CREATE TABLE "two_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "two_factors_secret_idx" ON "two_factors"("secret");
CREATE INDEX "two_factors_user_id_idx" ON "two_factors"("user_id");

ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: passkeys (passkey plugin)
CREATE TABLE "passkeys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT,
    "public_key" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "device_type" TEXT NOT NULL,
    "backed_up" BOOLEAN NOT NULL,
    "transports" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "aaguid" TEXT,

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "passkeys_user_id_idx" ON "passkeys"("user_id");
CREATE INDEX "passkeys_credential_id_idx" ON "passkeys"("credential_id");

ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS · `users` now allows tenant_id-NULL rows.
--
-- Better-Auth's anonymous sign-up flow creates a user before any
-- tenant pre-pick has happened, so the row's `tenant_id` is NULL.
-- The previous policy compared `tenant_id::text = current_setting(...)`
-- which evaluates to NULL for null rows, blocking the INSERT entirely.
-- Relaxing to "either match the request tenant OR be unattached"
-- keeps tenant-scoped reads safe while letting Better-Auth complete
-- the signup. Linking the user to a tenant later (via
-- TenantMember.activate or the system-setup admin bootstrap) is the
-- canonical path that re-stamps `tenant_id`.
DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users
  USING (
    tenant_id IS NULL
    OR tenant_id::text = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );
