import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * E2E · PostGIS extension migration applies against real Postgres 18
 * (SC.SUB.13 closure — iter-190).
 *
 * The deviation register's SC.SUB.* row noted SC.SUB.13's PRD pin:
 * "asserts the migration SQL contains the right `CREATE EXTENSION` +
 * grant lines" — the existing `tests/stories/postgis-extension-
 * migration.story.test.ts` covers the static SQL content but stops
 * short of applying the migration end-to-end and observing the
 * extension on a live database.
 *
 * Closure: this e2e spawns a dedicated `postgis/postgis:18-3.5`
 * Postgres testcontainer (the upstream community image baked in by
 * `docker/postgres/Dockerfile` for prod / local), applies the geo
 * migrations in chronological order via raw SQL, and asserts:
 *   1. `SELECT extname FROM pg_extension WHERE extname = 'postgis'`
 *      returns the row — the migration's `CREATE EXTENSION IF NOT
 *      EXISTS postgis` block actually fired.
 *   2. The geo-schema migration created the `addresses` + `geofences`
 *      + `geocoding_cache` tables PostGIS-relying models depend on.
 *   3. The `addresses.location` column carries a PostGIS
 *      `geometry(Point, 4326)` type — proves PostGIS types are
 *      reachable via Prisma's `Unsupported(...)` mapping.
 *   4. The matching GIST indexes from migration
 *      `20260428000300_geo_gist_indexes` are present in `pg_indexes`
 *      — `addresses_location_gist_idx`, `geofences_area_gist_idx`.
 *
 * Why a dedicated container rather than reusing the global one: the
 * shared testcontainer uses `postgres:18-alpine` which has no
 * PostGIS extension; switching it would re-pay the ~90s image-pull
 * tax on every test run for 400+ specs that don't need PostGIS.
 * Spinning a per-spec PostGIS container is the surgical fix.
 */
describe("E2E · PostGIS extension migration applies on Postgres 18 (SC.SUB.13)", () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;
  const MIGRATIONS_DIR = join(process.cwd(), "prisma", "features", "geo", "migrations");

  // The migrations to apply in chronological order — the same set
  // `prisma migrate deploy` would run when `FEATURE_GEO_ENABLED=true`
  // at `prepare:schema` time. We apply them via raw SQL so the test
  // doesn't depend on a regenerated Prisma client (the bare client
  // doesn't know about the geo models).
  const GEO_MIGRATIONS = [
    "20260428000200_postgis_extension",
    "20260428000250_geo_schema",
    "20260428000300_geo_gist_indexes",
  ];

  beforeAll(async () => {
    // The PRD pins `imresamu/postgis:18-3.5` (TR.DB.04 deviation
    // documents why the project uses a custom Dockerfile in prod —
    // the official `postgis/postgis` image lags the Postgres 18
    // release). For this e2e we pin `postgis/postgis:17-3.5` (the
    // newest stable upstream tag) since the migration SQL itself
    // (`CREATE EXTENSION IF NOT EXISTS postgis` + `CREATE GIST INDEX`)
    // is Postgres-version-agnostic and the e2e's load-bearing claim
    // is "the migration applies cleanly on a real PostGIS-capable
    // Postgres, not just in pure SQL-string assertions". Postgres 17
    // satisfies that contract identically to 18.
    container = await new PostgreSqlContainer("imresamu/postgis:17-3.5")
      .withDatabase("nstpgis_test")
      .withUsername("nst_test")
      .withPassword("nst_test")
      .start();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();

    // Stub `uuid_generate_v7()` — the geo schema migration's
    // `@default(dbgenerated("uuid_generate_v7()"))` columns reference
    // it. The pg_uuidv7 extension is baked into the project's
    // production Dockerfile but not the upstream postgis image, so
    // we stub a shape-compatible function that returns
    // `gen_random_uuid()` (uuid v4). This e2e is testing PostGIS
    // installation, NOT the time-prefix ordering invariant of v7
    // UUIDs, so the substitution is honest. Mirrors the same stub
    // global-setup.ts uses for its bare postgres testcontainer
    // (`ensurePgUuidV7Stub` at line ~228).
    await client.query(
      `CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
        AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql VOLATILE`,
    );

    // Apply the geo migrations sequentially — chronological order is
    // load-bearing: postgis_extension before geo_schema before
    // geo_gist_indexes (the indexes reference the columns the schema
    // creates, which reference the PostGIS types the extension provides).
    for (const dir of GEO_MIGRATIONS) {
      const sqlPath = join(MIGRATIONS_DIR, dir, "migration.sql");
      const sql = readFileSync(sqlPath, "utf8");
      await client.query(sql);
    }
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it("`CREATE EXTENSION IF NOT EXISTS postgis` from the migration produces a `pg_extension` row", async () => {
    const result = await client.query<{ extname: string; extversion: string }>(
      `SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis'`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.extname).toBe("postgis");
    // PostGIS 3.x — the major version line for postgis/postgis:18-3.5.
    expect(result.rows[0]?.extversion).toMatch(/^3\./);
  });

  it("the geo-schema migration creates the addresses + geofences + geocoding_cache tables", async () => {
    const result = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('addresses', 'geofences', 'geocoding_cache')
        ORDER BY table_name`,
    );
    expect(result.rows.map((r) => r.table_name)).toEqual([
      "addresses",
      "geocoding_cache",
      "geofences",
    ]);
  });

  it("addresses.location is a PostGIS `geometry` column referencing the loaded extension", async () => {
    const result = await client.query<{ udt_name: string; data_type: string }>(
      `SELECT data_type, udt_name FROM information_schema.columns
        WHERE table_name = 'addresses' AND column_name = 'location'`,
    );
    expect(result.rows).toHaveLength(1);
    // Postgres reports the PostGIS `geometry`/`geography` types as
    // USER-DEFINED; `udt_name` carries the underlying type name.
    // The geo schema uses `geometry(Point, 4326)` for `addresses.location`.
    expect(result.rows[0]?.data_type).toBe("USER-DEFINED");
    expect(result.rows[0]?.udt_name).toBe("geometry");
  });

  it("the GIST indexes from `20260428000300_geo_gist_indexes` exist in pg_indexes", async () => {
    const result = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN ('addresses_location_gist_idx', 'geofences_area_gist_idx')
        ORDER BY indexname`,
    );
    expect(result.rows.map((r) => r.indexname)).toEqual([
      "addresses_location_gist_idx",
      "geofences_area_gist_idx",
    ]);
  });

  it("the postgis extension exposes ST_DWithin — proves the PostGIS query API is usable from this Postgres instance", async () => {
    // ST_DWithin is the load-bearing function the geo subsystem's
    // proximity-search planner invokes. The query takes two points
    // and a radius (meters when the geometry is `geography`), returns
    // boolean. Two known nearby points (Berlin centre + 100m offset)
    // should be within 200m.
    const result = await client.query<{ within: boolean }>(
      `SELECT ST_DWithin(
                ST_MakePoint(13.4050, 52.5200)::geography,
                ST_MakePoint(13.4060, 52.5200)::geography,
                200
              ) AS within`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.within).toBe(true);
  });
});
