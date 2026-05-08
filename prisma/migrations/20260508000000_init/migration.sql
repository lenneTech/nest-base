-- =============================================================================
-- init — complete baseline schema for nest-base
--
-- Squash of all 32 incremental migrations into a single file.
-- No backwards-compatibility concern: this is a template; consumers
-- start fresh and append their own migrations after this baseline.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

-- pg_uuidv7 is baked into the project's Docker Postgres image.
-- The DO block makes this migration safe on vanilla postgres:18-alpine
-- (e.g. testcontainers) where the extension binary is absent.
-- Test global-setup installs a stub uuid_generate_v7() in that case.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_uuidv7;
EXCEPTION WHEN OTHERS THEN
  NULL; -- extension binary not present; stub function handles tests
END $$;


-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."EmailOutboxKind" AS ENUM ('SEND', 'SEND_TEMPLATE');

-- CreateEnum
CREATE TYPE "public"."EmailOutboxStatus" AS ENUM ('PENDING', 'SENT', 'DEAD_LETTER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."FileVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "public"."PermissionAction" AS ENUM ('CREATE', 'READ', 'UPDATE', 'DELETE', 'SHARE');

-- CreateEnum
CREATE TYPE "public"."WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."WebhookEndpointStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "public"."audit_action" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'INVOKE', 'REVOKE');

-- CreateTable
CREATE TABLE "public"."_health_ping" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_health_ping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."accounts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
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

-- CreateTable
CREATE TABLE "public"."api_keys" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "lookup_id" UUID NOT NULL,
    "hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[],
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_notified_at" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."asset_variant_index" (
    "cache_key" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "options_hash" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_variant_index_pkey" PRIMARY KEY ("cache_key")
);

-- CreateTable
CREATE TABLE "public"."audit_log" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "tenant_id" UUID,
    "actor_user_id" UUID,
    "target_model" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "action" "public"."audit_action" NOT NULL,
    "diff" JSONB NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_outbox" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "kind" "public"."EmailOutboxKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotency_key" TEXT,
    "status" "public"."EmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "succeeded_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."examples" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "examples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."file_blobs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "body" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_blobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."files" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "tenant_id" UUID NOT NULL,
    "folder_id" UUID,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_driver" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploader_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "visibility" "public"."FileVisibility" NOT NULL DEFAULT 'PRIVATE',

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."folders" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."idempotency_records" (
    "key" TEXT NOT NULL,
    "user_id" UUID,
    "request_hash" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."invitation" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "inviter_id" UUID NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."jwks" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "public_key" TEXT NOT NULL,
    "private_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "jwks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."member" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "logo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "metadata" TEXT,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."outbox_entries" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "seq" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "outbox_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."passkeys" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
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

-- CreateTable
CREATE TABLE "public"."pending_erasures" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_erasures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."permissions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "policy_id" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "action" "public"."PermissionAction" NOT NULL,
    "item_filter" JSONB,
    "fields" TEXT[],
    "validation" JSONB,
    "presets" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."policies" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."rate_limit_allowlist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_allowlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."rate_limit_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" TEXT NOT NULL,
    "max_requests" INTEGER NOT NULL,
    "window_seconds" INTEGER NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."rate_limit_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bucket_key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "limit" INTEGER NOT NULL,
    "window_secs" INTEGER NOT NULL,
    "ip" TEXT,
    "user_id" UUID,
    "ts" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."role_policies" (
    "role_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,

    CONSTRAINT "role_policies_pkey" PRIMARY KEY ("role_id","policy_id")
);

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "parent_id" UUID,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sessions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "fingerprint" VARCHAR(64),
    "active_organization_id" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."system_secrets" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_secrets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."tenant_settings" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "organization_id" TEXT NOT NULL,
    "logo_url" TEXT,
    "primary_color" TEXT,
    "storage_limit_mb" INTEGER,
    "contact_email" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."throttler_records" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "throttler_records_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."two_factors" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_profiles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "bio" TEXT,
    "phone_number" TEXT,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "two_factor_enabled" BOOLEAN,
    "email_hash" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."verifications" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "endpoint_id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "status" "public"."WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "status_code" INTEGER,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_test" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."webhook_endpoints" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "tenant_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "status" "public"."WebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "public"."accounts"("user_id" ASC);

-- CreateIndex
CREATE INDEX "api_keys_expires_at_idx" ON "public"."api_keys"("expires_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_lookup_id_key" ON "public"."api_keys"("lookup_id" ASC);

-- CreateIndex
CREATE INDEX "asset_variant_index_created_at_idx" ON "public"."asset_variant_index"("created_at" ASC);

-- CreateIndex
CREATE INDEX "asset_variant_index_source_key_idx" ON "public"."asset_variant_index"("source_key" ASC);

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_created_at_idx" ON "public"."audit_log"("actor_user_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "audit_log_target_model_target_id_idx" ON "public"."audit_log"("target_model" ASC, "target_id" ASC);

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "public"."audit_log"("tenant_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_idempotency_key_key" ON "public"."email_outbox"("idempotency_key" ASC);

-- CreateIndex
CREATE INDEX "email_outbox_status_created_at_idx" ON "public"."email_outbox"("status" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "email_outbox_status_next_attempt_at_idx" ON "public"."email_outbox"("status" ASC, "next_attempt_at" ASC);

-- CreateIndex
CREATE INDEX "examples_tenant_id_idx" ON "public"."examples"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "file_blobs_tenant_id_key_key" ON "public"."file_blobs"("tenant_id" ASC, "key" ASC);

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "public"."idempotency_records"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "invitation_organization_id_idx" ON "public"."invitation"("organization_id" ASC);

-- CreateIndex
CREATE INDEX "member_organization_id_idx" ON "public"."member"("organization_id" ASC);

-- CreateIndex
CREATE INDEX "member_user_id_idx" ON "public"."member"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "public"."organization"("slug" ASC);

-- CreateIndex
CREATE INDEX "outbox_entries_processed_at_seq_idx" ON "public"."outbox_entries"("processed_at" ASC, "seq" ASC);

-- CreateIndex
CREATE INDEX "passkeys_credential_id_idx" ON "public"."passkeys"("credential_id" ASC);

-- CreateIndex
CREATE INDEX "passkeys_user_id_idx" ON "public"."passkeys"("user_id" ASC);

-- CreateIndex
CREATE INDEX "pending_erasures_eligible_idx" ON "public"."pending_erasures"("completed_at" ASC, "cancelled_at" ASC, "requested_at" ASC);

-- CreateIndex
CREATE INDEX "pending_erasures_user_id_idx" ON "public"."pending_erasures"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "permissions_policy_id_resource_action_key" ON "public"."permissions"("policy_id" ASC, "resource" ASC, "action" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "policies_name_key" ON "public"."policies"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_allowlist_user_id_key" ON "public"."rate_limit_allowlist"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_configs_scope_key" ON "public"."rate_limit_configs"("scope" ASC);

-- CreateIndex
CREATE INDEX "rate_limit_decisions_bucket_key_idx" ON "public"."rate_limit_decisions"("bucket_key" ASC);

-- CreateIndex
CREATE INDEX "rate_limit_decisions_ts_idx" ON "public"."rate_limit_decisions"("ts" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_name_key" ON "public"."roles"("tenant_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "public"."sessions"("token" ASC);

-- CreateIndex
CREATE INDEX "sessions_user_id_fingerprint_idx" ON "public"."sessions"("user_id" ASC, "fingerprint" ASC);

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "public"."sessions"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_organization_id_key" ON "public"."tenant_settings"("organization_id" ASC);

-- CreateIndex
CREATE INDEX "throttler_records_expires_at_idx" ON "public"."throttler_records"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "two_factors_secret_idx" ON "public"."two_factors"("secret" ASC);

-- CreateIndex
CREATE INDEX "two_factors_user_id_idx" ON "public"."two_factors"("user_id" ASC);

-- CreateIndex
CREATE INDEX "user_profiles_tenant_id_idx" ON "public"."user_profiles"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "public"."user_profiles"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_hash_key" ON "public"."users"("email_hash" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE INDEX "verifications_expires_at_idx" ON "public"."verifications"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "public"."verifications"("identifier" ASC);

-- AddForeignKey
ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."files" ADD CONSTRAINT "files_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."folders" ADD CONSTRAINT "folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invitation" ADD CONSTRAINT "invitation_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."invitation" ADD CONSTRAINT "invitation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."member" ADD CONSTRAINT "member_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."member" ADD CONSTRAINT "member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."passkeys" ADD CONSTRAINT "passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pending_erasures" ADD CONSTRAINT "pending_erasures_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."permissions" ADD CONSTRAINT "permissions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_policies" ADD CONSTRAINT "role_policies_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_policies" ADD CONSTRAINT "role_policies_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."roles" ADD CONSTRAINT "roles_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_settings" ADD CONSTRAINT "tenant_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."two_factors" ADD CONSTRAINT "two_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row Level Security — tenant isolation
-- ---------------------------------------------------------------------------

ALTER TABLE "users"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "file_blobs"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "folders"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "files"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "examples"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_profiles"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pending_erasures"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_entries"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings"   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_roles" ON "roles"
  USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)))
  WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

CREATE POLICY "tenant_isolation_file_blobs" ON "file_blobs"
  USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)))
  WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

CREATE POLICY "tenant_isolation_folders" ON "folders"
  USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)))
  WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

CREATE POLICY "tenant_isolation_files" ON "files"
  USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)))
  WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

CREATE POLICY "tenant_isolation_webhook_endpoints" ON "webhook_endpoints"
  USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)))
  WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

CREATE POLICY "tenant_isolation_examples" ON "examples"
  USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)))
  WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

CREATE POLICY "tenant_isolation_user_profiles" ON "user_profiles"
  USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)))
  WITH CHECK (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
  USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

CREATE POLICY "pending_erasures_all" ON "pending_erasures"
  USING (true)
  WITH CHECK (true);

CREATE POLICY "outbox_entries_all" ON "outbox_entries"
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_settings_admin_bypass" ON "tenant_settings"
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- PowerSync replication bootstrap (feature: FEATURE_POWERSYNC_ENABLED)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync') THEN
    CREATE ROLE powersync WITH REPLICATION LOGIN PASSWORD 'change-me-at-runtime';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
    CREATE PUBLICATION powersync FOR ALL TABLES;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO powersync;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync;
