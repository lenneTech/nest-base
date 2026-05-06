-- ApiKey expiresAt index (iter-199 reviewer-flagged G1 closure).
-- The `ApiKeyExpiryRunner` (CF.AUTH.17) issues a daily cron over the
-- `api_keys` table filtering on `expires_at IS NOT NULL AND
-- expires_at > NOW()` (`src/core/auth/api-keys/api-key-expiry.factory.ts`).
-- Without this index the cron's hot-path scan was sequential over
-- every active key; sister tables (`throttler_records`,
-- `idempotency_records`, `verifications`) all already had their
-- `expires_at_idx` shipped, so this closes the parity gap.
--
-- Schema source of truth: `@@index([expiresAt])` on `ApiKey` in
-- `prisma/schema.prisma`.

CREATE INDEX "api_keys_expires_at_idx"
  ON "api_keys" ("expires_at");
