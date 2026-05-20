-- Better-Auth admin plugin user/session fields
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "role" TEXT DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS "banned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ban_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "ban_expires" TIMESTAMP(3);

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "impersonated_by" TEXT;
