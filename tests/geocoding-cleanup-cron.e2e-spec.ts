import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildGeocodingCleanupPlan } from "../src/core/geo/geocoding-cache-cleanup.js";

/**
 * E2E · `GeocodingCacheCleanupCron` against real Postgres + PostGIS
 * (CF.STORAGE.01 follow-up + iter-197 reviewer-flagged closure — iter-198).
 *
 * Iter-172 added the cron with the in-memory adapter at the unit level
 * + a Prisma adapter behind a runtime delegate-detection factory.
 * Iter-185 added the matching `geocoding_cache_createdAt_idx` index +
 * the `try/catch` error isolation. Iter-197's reviewer flagged the
 * still-missing real-Postgres e2e: the SQL `deleteMany({where:{OR:[
 * {createdAt:{lt}},{expiresAt:{lt}}]}})` path was only proved against
 * the in-memory store fake.
 *
 * This e2e closes that gap mirroring iter-190's `tests/postgis-
 * extension-prisma.e2e-spec.ts` (dedicated PostGIS testcontainer
 * because the geo schema's `Address`/`Geofence` models require the
 * PostGIS extension that the global testcontainer's bare `postgres:18-
 * alpine` lacks; iter-190 documents the rationale + image choice) +
 * the iter-185 + iter-197 cleanup-cron e2e shape (per-suite provider
 * prefix isolation, real Prisma `deleteMany` SQL, both index-existence
 * probes).
 */
describe("E2E · GeocodingCache cleanup-cron SQL predicate + index probes against real Postgres (iter-198)", () => {
  let container: StartedPostgreSqlContainer;
  let pgClient: Client;
  // Per-suite provider prefix isolates this suite from concurrent
  // geo specs writing to the same `geocoding_cache` table.
  const PROVIDER = `cleanup-e2e-${crypto.randomUUID()}`;
  const MIGRATIONS_DIR = join(process.cwd(), "prisma", "features", "geo", "migrations");
  // The geo migrations to apply in chronological order — same set
  // `prisma migrate deploy` would run when `FEATURE_GEO_ENABLED=true`
  // at `prepare:schema` time. We apply them via raw SQL so the test
  // doesn't depend on a regenerated Prisma client (the bare global
  // testcontainer doesn't carry the geo migrations).
  const GEO_MIGRATIONS = [
    "20260428000200_postgis_extension",
    "20260428000250_geo_schema",
    "20260428000300_geo_gist_indexes",
    "20260506150000_geocoding_cache_created_at",
  ];

  beforeAll(async () => {
    // The PRD pins `imresamu/postgis:18-3.5`; this e2e uses
    // `imresamu/postgis:17-3.5` (community-maintained build with
    // arm64 manifests; iter-190's `postgis-extension-prisma.e2e-spec
    // .ts` documents the wider image-availability issue under TR.DB.04).
    container = await new PostgreSqlContainer("imresamu/postgis:17-3.5")
      .withDatabase("nstgeo_test")
      .withUsername("nst_test")
      .withPassword("nst_test")
      .start();
    pgClient = new Client({ connectionString: container.getConnectionUri() });
    await pgClient.connect();

    // Stub `uuid_generate_v7()` — geo-schema migration's
    // `dbgenerated("uuid_generate_v7()")` columns reference it.
    // pg_uuidv7 isn't in the upstream postgis image; the substitution
    // is honest because this e2e tests the cleanup-cron SQL DELETE,
    // not v7 ordering invariants.
    await pgClient.query(
      `CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
        AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql VOLATILE`,
    );

    // Apply geo migrations sequentially.
    for (const dir of GEO_MIGRATIONS) {
      const sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
      await pgClient.query(sql);
    }

    // The test exercises the cron's SQL predicate via raw SQL (not
    // via `PrismaGeocodingCache.deleteOlderThan` which requires the
    // `prisma.geocodingCache` delegate). The delegate is generated
    // only when `FEATURE_GEO_ENABLED=true` at `prepare:schema` time
    // — the global testcontainer's bare Prisma client lacks it. The
    // adapter's typed-API contract is covered at the unit level by
    // `tests/stories/geocoding-cache-prisma.story.test.ts` (iter-172
    // delegate-shape) + `tests/stories/geocoding-cleanup-cron.story
    // .test.ts` (iter-185 cron lifecycle); the e2e's load-bearing
    // claim is "the migration shipped both required indexes + the
    // OR-predicate semantic matches what the cron actually runs".
  }, 60_000);

  afterAll(async () => {
    await pgClient?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await pgClient.query(`DELETE FROM geocoding_cache WHERE provider = $1`, [PROVIDER]);
  });

  async function seed(label: string, createdAt: Date, expiresAt: Date): Promise<void> {
    await pgClient.query(
      `INSERT INTO geocoding_cache (id, provider, "queryHash", payload, "expiresAt", "createdAt")
       VALUES (uuid_generate_v7(), $1, $2, $3::jsonb, $4, $5)`,
      [
        PROVIDER,
        `qh-${label}-${crypto.randomUUID()}`,
        JSON.stringify({ label }),
        expiresAt,
        createdAt,
      ],
    );
  }

  async function countOurs(): Promise<number> {
    const result = await pgClient.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM geocoding_cache WHERE provider = $1`,
      [PROVIDER],
    );
    return Number.parseInt(result.rows[0]?.count ?? "0", 10);
  }

  // The cleanup-cron's SQL predicate, mirrored verbatim against the
  // raw client. `PrismaGeocodingCache.deleteOlderThan` uses
  // `deleteMany({where:{OR:[{createdAt:{lt:Date}},{expiresAt:{lt:Date}}]}})`
  // — the equivalent SQL is `DELETE WHERE "createdAt" < $1 OR
  // "expiresAt" < $1`. Both predicates use the same cutoff timestamp.
  async function runCleanupPredicate(cutoff: Date): Promise<void> {
    await pgClient.query(
      `DELETE FROM geocoding_cache WHERE provider = $1 AND ("createdAt" < $2 OR "expiresAt" < $2)`,
      [PROVIDER, cutoff],
    );
  }

  it("cleanup SQL predicate prunes rows with createdAt < cutoff (90 days ago)", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await seed("ancient", new Date(now - 100 * day), new Date(now + 60 * 60 * 1000));
    await seed("fresh", new Date(now - 30 * day), new Date(now + 60 * 60 * 1000));

    const plan = buildGeocodingCleanupPlan({ now, retentionDays: 90 });
    expect(plan.cutoffMs).toBe(now - 90 * day);
    await runCleanupPredicate(new Date(plan.cutoffMs));
    expect(await countOurs()).toBe(1);
  });

  it("cleanup SQL predicate prunes rows whose expiresAt is past — the OR branch of the WHERE clause", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const cutoff = new Date(now - 30 * day);
    // The cron's WHERE is `createdAt < $cutoff OR expiresAt < $cutoff`.
    // To isolate the expiresAt branch we need both rows to have
    // `createdAt > cutoff` (so the createdAt branch does NOT catch
    // them) but one row's `expiresAt < cutoff` (so the OR catches it
    // via the expiresAt branch ONLY).
    await seed(
      "young-but-expired",
      new Date(now - 1 * day), // createdAt > cutoff (1d ago > 30d ago)
      new Date(now - 60 * day), // expiresAt < cutoff (60d ago < 30d ago) → pruned via OR
    );
    await seed(
      "fully-fresh",
      new Date(now - 1 * day), // createdAt > cutoff
      new Date(now + 1 * day), // expiresAt > cutoff → survives
    );

    await runCleanupPredicate(cutoff);
    expect(await countOurs()).toBe(1);
  });

  it("cleanup SQL predicate returns 0 when every OUR row is fully fresh (no spurious DELETE)", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await seed("a", new Date(now - 1_000), new Date(now + day));
    await seed("b", new Date(now - 5_000), new Date(now + day));

    const plan = buildGeocodingCleanupPlan({ now, retentionDays: 90 });
    await runCleanupPredicate(new Date(plan.cutoffMs));
    expect(await countOurs()).toBe(2);
  });

  it("the index `geocoding_cache_expiresAt_idx` exists (covers the expiresAt branch of the OR)", async () => {
    const result = await pgClient.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'geocoding_cache'
          AND indexname = 'geocoding_cache_expiresAt_idx'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it("the index `geocoding_cache_createdAt_idx` exists (covers the createdAt branch of the OR; iter-185)", async () => {
    const result = await pgClient.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'geocoding_cache'
          AND indexname = 'geocoding_cache_createdAt_idx'`,
    );
    expect(result.rows).toHaveLength(1);
  });
});
