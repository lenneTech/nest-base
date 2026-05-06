-- Migration: system_secrets table for Hub auth (issue #83)
--
-- Stores server-managed key/value secrets. The Hub password hash
-- is stored as key = 'hub_password_hash'. The table is append-only
-- from the application's perspective — the service upserts by key
-- and never deletes rows. `updated_at` enables rotation auditing.

CREATE TABLE "system_secrets" (
    "key"        TEXT         NOT NULL,
    "value"      TEXT         NOT NULL,
    "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "system_secrets_pkey" PRIMARY KEY ("key")
);
