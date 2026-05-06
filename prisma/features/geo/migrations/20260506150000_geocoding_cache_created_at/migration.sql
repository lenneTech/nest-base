-- GeocodingCache createdAt index (CF.STORAGE.01 follow-up — iter-185).
-- The `GeocodingCacheCleanupCron` filters on
-- `"createdAt" < $1 OR "expiresAt" < $2` (`buildGeocodingCleanupPlan`)
-- to prune entries past the 90-day retention window. Without this
-- index Postgres falls back to a sequential scan on the `createdAt`
-- predicate of the OR — once the index ships the prune planner can
-- choose either branch as a B-tree range scan.
--
-- Schema source of truth: `@@index([createdAt])` on `GeocodingCache`
-- in `prisma/features/geo.prisma`.

CREATE INDEX "geocoding_cache_createdAt_idx"
  ON "geocoding_cache" ("createdAt");
