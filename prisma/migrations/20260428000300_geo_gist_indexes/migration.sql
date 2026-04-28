-- GIST indexes for the geo feature (PLAN.md §15 + §32 Phase 5c).
--
-- Prisma can't declare GIST indexes on `Unsupported("geometry(...)")` columns,
-- so we ship them as raw SQL. Idempotent (`IF NOT EXISTS`) so a consumer
-- re-running migrations on a database that already has them doesn't conflict.
--
-- Runs after the `addresses` and `geofences` tables exist (`prepare:schema`
-- followed by `prisma migrate dev` will have created them when the geo
-- feature is enabled).

CREATE INDEX IF NOT EXISTS "addresses_location_gist_idx"
  ON "addresses"
  USING GIST ("location");

CREATE INDEX IF NOT EXISTS "geofences_area_gist_idx"
  ON "geofences"
  USING GIST ("area");
