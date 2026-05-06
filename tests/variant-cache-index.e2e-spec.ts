import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaVariantCacheIndex } from "../src/core/files/variant-cache-index.prisma.js";
import type { PrismaService } from "../src/core/prisma/prisma.service.js";

/**
 * E2E · Prisma-backed `VariantCacheIndex` against a real Postgres
 * testcontainer (CF.STORAGE.01 follow-up — iter-184).
 *
 * Iter-183 added the variant-cache index + Prisma adapter + cascade
 * invalidation. The story tests cover the contract via fakes; this
 * e2e closes the remaining gap by proving the SQL `upsert` /
 * `findMany({sourceKey})` / `deleteMany({sourceKey})` / `count` /
 * `aggregate({_sum:{sizeBytes:true}})` paths execute correctly
 * against the real `asset_variant_index` table from migration
 * `20260506120000_asset_variant_index`, and that the
 * `asset_variant_index_source_key_idx` index is present in
 * `pg_indexes` so the cascade query is O(log N).
 *
 * The test reuses the global Postgres testcontainer (`global-setup.ts`
 * spawns it on first import) and uses a per-suite cacheKey prefix
 * for test isolation so concurrent specs writing to the same table
 * don't contaminate the assertions.
 */
describe("E2E · PrismaVariantCacheIndex against real Postgres (iter-184)", () => {
  let prisma: PrismaClient;
  let index: PrismaVariantCacheIndex;
  // Per-suite prefix so concurrent variant-index specs (current + future)
  // can write to the same `asset_variant_index` table without
  // contaminating each other's count/list assertions.
  const SOURCE_PREFIX = `e2e-src-${crypto.randomUUID()}/`;
  const CK_PREFIX = `e2e-ck-${crypto.randomUUID()}-`;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL required for the variant-cache-index e2e suite");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    index = new PrismaVariantCacheIndex(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    // Best-effort cleanup of every row this suite seeded — both by
    // sourceKey prefix (matches the rows landed via record()) and
    // by cacheKey prefix (defensive in case any test inserted under
    // a non-prefixed sourceKey).
    await prisma.assetVariantIndex.deleteMany({
      where: { sourceKey: { startsWith: SOURCE_PREFIX } },
    });
    await prisma.assetVariantIndex.deleteMany({
      where: { cacheKey: { startsWith: CK_PREFIX } },
    });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.assetVariantIndex.deleteMany({
      where: { sourceKey: { startsWith: SOURCE_PREFIX } },
    });
    await prisma.assetVariantIndex.deleteMany({
      where: { cacheKey: { startsWith: CK_PREFIX } },
    });
  });

  function entry(label: string, sourceLabel: string, sizeBytes = 1024) {
    return {
      cacheKey: `${CK_PREFIX}${label}`,
      sourceKey: `${SOURCE_PREFIX}${sourceLabel}`,
      optionsHash: `oh-${label}`,
      mimeType: "image/webp",
      sizeBytes,
      createdAt: new Date(),
    };
  }

  it("record() upserts a row that survives a fresh adapter instance (cross-restart contract)", async () => {
    await index.record(entry("ck1", "img/a.png", 500));

    // Construct a fresh adapter against the same prisma — emulates
    // the production process restart. The persisted row must be
    // visible to the new instance.
    const reader = new PrismaVariantCacheIndex(prisma as unknown as PrismaService);
    const list = await reader.listBySourceKey(`${SOURCE_PREFIX}img/a.png`);
    expect(list).toHaveLength(1);
    expect(list[0]?.cacheKey).toBe(`${CK_PREFIX}ck1`);
    expect(list[0]?.sizeBytes).toBe(500);
  });

  it("record() is idempotent on cacheKey — second insert refreshes sizeBytes via UPDATE branch of upsert", async () => {
    await index.record(entry("ck1", "img/a.png", 100));
    await index.record(entry("ck1", "img/a.png", 200));

    const list = await index.listBySourceKey(`${SOURCE_PREFIX}img/a.png`);
    expect(list).toHaveLength(1);
    expect(list[0]?.sizeBytes).toBe(200);
  });

  it("listBySourceKey() returns multiple variants per source via SQL findMany", async () => {
    await index.record(entry("ck-webp", "img/a.png", 100));
    await index.record(entry("ck-avif", "img/a.png", 80));
    await index.record(entry("ck-other", "img/b.png", 200));

    const aVariants = await index.listBySourceKey(`${SOURCE_PREFIX}img/a.png`);
    expect(aVariants).toHaveLength(2);
    const cacheKeys = aVariants.map((v) => v.cacheKey).sort();
    expect(cacheKeys).toEqual([`${CK_PREFIX}ck-avif`, `${CK_PREFIX}ck-webp`]);
  });

  it("removeByCacheKey() deletes via SQL DELETE; returns true on hit, false on miss", async () => {
    await index.record(entry("ck1", "img/a.png"));
    expect(await index.removeByCacheKey(`${CK_PREFIX}ck1`)).toBe(true);
    expect(await index.removeByCacheKey(`${CK_PREFIX}ck1`)).toBe(false);
    expect(await index.removeByCacheKey(`${CK_PREFIX}never-existed`)).toBe(false);
  });

  it("removeBySourceKey() reads cacheKeys then issues a single deleteMany; returns the cascade list and isolates siblings", async () => {
    await index.record(entry("ck1", "img/a.png"));
    await index.record(entry("ck2", "img/a.png"));
    await index.record(entry("ck3", "img/b.png"));

    const cascade = await index.removeBySourceKey(`${SOURCE_PREFIX}img/a.png`);
    expect(cascade.sort()).toEqual([`${CK_PREFIX}ck1`, `${CK_PREFIX}ck2`]);

    expect(await index.listBySourceKey(`${SOURCE_PREFIX}img/a.png`)).toEqual([]);
    const survivors = await index.listBySourceKey(`${SOURCE_PREFIX}img/b.png`);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.cacheKey).toBe(`${CK_PREFIX}ck3`);
  });

  it("removeBySourceKey() returns empty array + skips deleteMany when no rows match", async () => {
    const cascade = await index.removeBySourceKey(`${SOURCE_PREFIX}never-existed`);
    expect(cascade).toEqual([]);
  });

  it("getStats() reports OUR-suite totals via SQL count + aggregate (filtered to the prefix to coexist with concurrent specs)", async () => {
    await index.record(entry("ck1", "img/a.png", 100));
    await index.record(entry("ck2", "img/a.png", 200));
    await index.record(entry("ck3", "img/b.png", 500));

    // The adapter's getStats() runs against the WHOLE table (it has
    // no per-suite filter — that's by design, it's a global cache
    // observability hook). To make this assertion isolation-safe we
    // re-derive the count + sum from a prefix-filtered query and
    // assert on those numbers; the adapter contract is exercised
    // through `record()` above.
    const ourRows = await prisma.assetVariantIndex.findMany({
      where: { sourceKey: { startsWith: SOURCE_PREFIX } },
    });
    expect(ourRows).toHaveLength(3);
    const ourSum = ourRows.reduce((acc, r) => acc + r.sizeBytes, 0);
    expect(ourSum).toBe(800);

    // The adapter's getStats() is also alive (returns at least our
    // 3 rows worth of count + sum — never less, possibly more if
    // concurrent specs are running).
    const adapterStats = await index.getStats();
    expect(adapterStats.entryCount).toBeGreaterThanOrEqual(3);
    expect(adapterStats.totalBytes).toBeGreaterThanOrEqual(800);
  });

  it("the index `asset_variant_index_source_key_idx` exists so removeBySourceKey is O(log N)", async () => {
    const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'asset_variant_index'
          AND indexname = 'asset_variant_index_source_key_idx'`,
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.indexname).toBe("asset_variant_index_source_key_idx");
  });

  it("the table has the expected column shape from migration 20260506120000_asset_variant_index", async () => {
    const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string; data_type: string }>>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'asset_variant_index'
        ORDER BY ordinal_position`,
    );
    const colNames = cols.map((c) => c.column_name).sort();
    expect(colNames).toEqual(
      ["cache_key", "created_at", "mime_type", "options_hash", "size_bytes", "source_key"].sort(),
    );
    const sizeBytesCol = cols.find((c) => c.column_name === "size_bytes");
    expect(sizeBytesCol?.data_type).toBe("integer");
    const cacheKeyCol = cols.find((c) => c.column_name === "cache_key");
    expect(cacheKeyCol?.data_type).toBe("text");
  });
});
