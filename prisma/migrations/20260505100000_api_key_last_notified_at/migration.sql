-- ApiKey.lastNotifiedAt watermark (CF.AUTH.17 — iter-87).
-- Adds the column the ApiKeyExpiryRunner persists after a successful
-- expiry email so the daily cron tick doesn't re-notify within the
-- per-key cooldown window (default 24h).
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "last_notified_at" TIMESTAMP(3);
