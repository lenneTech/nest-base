import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { VariantCacheCleanupCron } from "../src/core/files/variant-cache-cleanup.js";
import { PrismaVariantCacheIndex } from "../src/core/files/variant-cache-index.prisma.js";
import type { PrismaService } from "../src/core/prisma/prisma.service.js";

/**
 * E2E · `VariantCacheCleanupCron` against real Postgres (iter-185).
 *
 * Iter-184 added the cron at the unit level (in-memory adapter +
 * legacy-adapter duck-typing fallback). This e2e closes the
 * remaining gap with a real-Postgres run mirroring the iter-182
 * idempotency-cleanup-cron e2e shape: real `PrismaClient` →
 * `PrismaVariantCacheIndex` → real `prisma.assetVariantIndex.deleteMany
 * ({where:{createdAt:{lt:Date}}})` → assert the cron's runOnce
 * actually removes rows past the 90-day cutoff and the matching
 * `asset_variant_index_created_at_idx` index exists in `pg_indexes`
 * so the prune is O(log N).
 *
 * Per-suite cacheKey prefix isolates the assertions from concurrent
 * specs writing to the same `asset_variant_index` table.
 */
describe("E2E · VariantCacheCleanupCron prunes orphan rows from real Postgres", () => {
  let prisma: PrismaClient;
  let store: PrismaVariantCacheIndex;
  let cron: VariantCacheCleanupCron;
  const PREFIX = `cleanup-e2e-${crypto.randomUUID()}::`;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL required for the variant-cache-cleanup e2e suite");
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    store = new PrismaVariantCacheIndex(prisma as unknown as PrismaService);
    cron = new VariantCacheCleanupCron(store);
  });

  afterAll(async () => {
    cron.onModuleDestroy();
    await prisma.assetVariantIndex.deleteMany({ where: { cacheKey: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.assetVariantIndex.deleteMany({ where: { cacheKey: { startsWith: PREFIX } } });
  });

  function pkey(label: string): string {
    return `${PREFIX}${label}-${crypto.randomUUID()}`;
  }

  async function countOurs(): Promise<number> {
    return await prisma.assetVariantIndex.count({
      where: { cacheKey: { startsWith: PREFIX } },
    });
  }

  it("runOnce() executes a SQL DELETE against rows with createdAt < cutoff (90 days ago)", async () => {
    const now = Date.now();
    // Insert via raw SQL so we can pin createdAt explicitly — the
    // adapter's record() defaults it to `Date.now()` server-side
    // (or `DEFAULT CURRENT_TIMESTAMP` when the column is omitted).
    await prisma.$executeRawUnsafe(
      `INSERT INTO asset_variant_index (cache_key, source_key, options_hash, mime_type, size_bytes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      pkey("ancient"),
      "src/a",
      "oh1",
      "image/webp",
      100,
      new Date(now - 100 * 24 * 60 * 60 * 1000), // 100 days ago
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO asset_variant_index (cache_key, source_key, options_hash, mime_type, size_bytes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      pkey("ancient"),
      "src/a",
      "oh2",
      "image/avif",
      150,
      new Date(now - 91 * 24 * 60 * 60 * 1000), // 91 days ago
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO asset_variant_index (cache_key, source_key, options_hash, mime_type, size_bytes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      pkey("fresh"),
      "src/a",
      "oh3",
      "image/webp",
      200,
      new Date(now - 30 * 24 * 60 * 60 * 1000), // 30 days ago — fresh
    );

    expect(await countOurs()).toBe(3);
    await cron.runOnce();
    // Two stale rows pruned, one fresh row remains. Concurrent
    // specs' rows aren't counted in OUR count.
    expect(await countOurs()).toBe(1);
  });

  it("runOnce() returns deleted=0 when every OUR row is still inside the retention window", async () => {
    const now = Date.now();
    await prisma.$executeRawUnsafe(
      `INSERT INTO asset_variant_index (cache_key, source_key, options_hash, mime_type, size_bytes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      pkey("fresh"),
      "src/b",
      "oh-fresh-1",
      "image/webp",
      300,
      new Date(now - 1 * 24 * 60 * 60 * 1000),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO asset_variant_index (cache_key, source_key, options_hash, mime_type, size_bytes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      pkey("fresh"),
      "src/b",
      "oh-fresh-2",
      "image/avif",
      400,
      new Date(now - 30 * 24 * 60 * 60 * 1000),
    );

    await cron.runOnce();
    expect(await countOurs()).toBe(2);
  });

  it("runOnce() is idempotent — second tick prunes nothing fresh because the first already cleaned", async () => {
    const now = Date.now();
    await prisma.$executeRawUnsafe(
      `INSERT INTO asset_variant_index (cache_key, source_key, options_hash, mime_type, size_bytes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      pkey("ancient"),
      "src/c",
      "oh-x",
      "image/webp",
      500,
      new Date(now - 200 * 24 * 60 * 60 * 1000),
    );

    await cron.runOnce();
    expect(await countOurs()).toBe(0);
    await cron.runOnce();
    expect(await countOurs()).toBe(0);
  });

  it("the index `asset_variant_index_created_at_idx` exists so the prune scan is O(log N) on row count", async () => {
    // The cleanup cron's deleteMany filters on `createdAt < cutoff`.
    // Without a matching index Postgres falls back to a sequential
    // scan; the migration that ships the table must therefore add
    // an index on `created_at` alongside `source_key`.
    const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'asset_variant_index'
          AND indexname = 'asset_variant_index_created_at_idx'`,
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.indexname).toBe("asset_variant_index_created_at_idx");
  });
});
