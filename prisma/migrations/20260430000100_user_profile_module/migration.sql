-- User-Profile module reference table.
--
-- Backs `src/modules/user-profile/` — the reference implementation
-- for "extend an existing framework-owned entity (the User) with
-- project-specific fields". 1:1 relation via the unique `user_id`
-- foreign key; `tenant_id` is denormalised so RLS policies fire
-- without joining the users table on every read.
--
-- ON DELETE CASCADE on the FK means a user-account erasure (Better-
-- Auth removes the user row, or the GDPR `/me/account` flow does)
-- automatically removes the profile too — no orphan rows.

CREATE TABLE user_profiles (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id      UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tenant_id    UUID         NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  bio          TEXT,
  phone_number TEXT,
  preferences  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX user_profiles_tenant_id_idx ON user_profiles (tenant_id);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_profiles_tenant_isolation ON user_profiles
  USING (tenant_id::text = current_setting('app.tenant_id', true));
