-- User.emailHash blind-index companion (CF.SEC.03 — iter-94).
-- Populated by the `userEmailBlindIndexExtension` on every
-- create/update of users via `prisma.client.user.*`. The unique
-- constraint mirrors the unique constraint on `email` so equality
-- lookups against `email_hash` carry the same uniqueness guarantee.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_hash" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_hash_key" ON "users" ("email_hash");
