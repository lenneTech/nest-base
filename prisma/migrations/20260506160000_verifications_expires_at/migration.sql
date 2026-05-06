-- Verifications expiresAt index (iter-193).
-- The `VerificationCleanupCron` filters on `expiresAt < cutoff` to
-- prune stale Better-Auth verification tokens older than 7 days.
-- Without this index Postgres falls back to a sequential scan;
-- once the index ships the prune is O(log N).
--
-- Schema source of truth: `@@index([expiresAt])` on `Verification`
-- in `prisma/schema.prisma`.

CREATE INDEX "verifications_expires_at_idx"
  ON "verifications" ("expires_at");
