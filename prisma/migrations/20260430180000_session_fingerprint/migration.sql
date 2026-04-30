-- Device-handling (issue #13).
--
-- Adds a `fingerprint` column to the Better-Auth-managed `sessions`
-- table. The column stores a sha256 hex hash of (mode, userAgent,
-- masked-ip-prefix) — see src/core/devices/fingerprint.ts for the
-- exact composition. Privacy contract: we store ONLY the hash; the
-- raw IP / UA stay in their existing columns and are deleted on
-- session expiry alongside the row.
--
-- Nullable so existing sessions (predating the feature) and
-- deployments that keep the device-management feature off continue
-- to work without a backfill.

ALTER TABLE "sessions"
  ADD COLUMN "fingerprint" VARCHAR(64);

-- Compound index — the device-handling planner reads "all known
-- fingerprints for a user" on every sign-in, so a (user_id,
-- fingerprint) covering index keeps the lookup index-only.
CREATE INDEX "sessions_user_id_fingerprint_idx"
  ON "sessions" ("user_id", "fingerprint");
