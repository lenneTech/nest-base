import { describe, expect, it } from "vitest";

import {
  PrismaVariantCacheIndex,
  hasPrismaVariantIndexDelegate,
} from "../../src/core/files/variant-cache-index.prisma.js";
import type { VariantCacheEntry } from "../../src/core/files/variant-cache-index.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Story · `PrismaVariantCacheIndex` (CF.STORAGE.01 final closure —
 * iter-183).
 *
 * Drives the Prisma adapter against a fake `prisma.assetVariantIndex`
 * delegate so the upsert / findMany / deleteMany / count / aggregate
 * mappings are locked without spinning up Postgres. The matching
 * e2e against the real testcontainer is a follow-up slice.
 */
describe("Story · PrismaVariantCacheIndex delegates to prisma.assetVariantIndex (iter-183)", () => {
  function fakePrisma(): {
    prisma: PrismaService;
    rows: Map<string, Record<string, unknown>>;
    captured: { upsert: unknown[]; deleteMany: unknown[] };
  } {
    const rows = new Map<string, Record<string, unknown>>();
    const captured = {
      upsert: [] as unknown[],
      deleteMany: [] as unknown[],
    };
    const fake = {
      assetVariantIndex: {
        async upsert(input: {
          where: { cacheKey: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) {
          captured.upsert.push(input);
          const existing = rows.get(input.where.cacheKey);
          const next = existing ? { ...existing, ...input.update } : { ...input.create };
          rows.set(input.where.cacheKey, next);
          return next;
        },
        async findMany(input: { where: { sourceKey: string } }) {
          return [...rows.values()].filter((r) => r["sourceKey"] === input.where.sourceKey);
        },
        async delete(input: { where: { cacheKey: string } }) {
          if (!rows.has(input.where.cacheKey)) {
            throw new Error("Record to delete does not exist.");
          }
          const existing = rows.get(input.where.cacheKey)!;
          rows.delete(input.where.cacheKey);
          return existing;
        },
        async deleteMany(input: { where: { sourceKey: string } }) {
          captured.deleteMany.push(input);
          let count = 0;
          for (const [key, row] of rows) {
            if (row["sourceKey"] === input.where.sourceKey) {
              rows.delete(key);
              count += 1;
            }
          }
          return { count };
        },
        async count() {
          return rows.size;
        },
        async aggregate() {
          let total = 0;
          for (const row of rows.values()) {
            total += (row["sizeBytes"] as number) ?? 0;
          }
          return { _sum: { sizeBytes: rows.size === 0 ? null : total } };
        },
      },
    };
    return { prisma: fake as unknown as PrismaService, rows, captured };
  }

  function entry(
    cacheKey: string,
    sourceKey: string,
    overrides: Partial<VariantCacheEntry> = {},
  ): VariantCacheEntry {
    return {
      cacheKey,
      sourceKey,
      optionsHash: `oh-${cacheKey}`,
      mimeType: "image/webp",
      sizeBytes: 1024,
      createdAt: new Date("2026-05-06T10:00:00Z"),
      ...overrides,
    };
  }

  it("record delegates to prisma.assetVariantIndex.upsert with row-shaped data", async () => {
    const { prisma, captured } = fakePrisma();
    const index = new PrismaVariantCacheIndex(prisma);
    await index.record(entry("ck1", "src/a.png", { sizeBytes: 555 }));
    expect(captured.upsert).toHaveLength(1);
    const call = captured.upsert[0] as {
      where: { cacheKey: string };
      create: Record<string, unknown>;
    };
    expect(call.where.cacheKey).toBe("ck1");
    expect(call.create["sourceKey"]).toBe("src/a.png");
    expect(call.create["sizeBytes"]).toBe(555);
  });

  it("listBySourceKey returns mapped entries via prisma.findMany", async () => {
    const { prisma } = fakePrisma();
    const index = new PrismaVariantCacheIndex(prisma);
    await index.record(entry("ck1", "src/a.png", { mimeType: "image/webp" }));
    await index.record(entry("ck2", "src/a.png", { mimeType: "image/avif" }));
    await index.record(entry("ck3", "src/b.png"));

    const aVariants = await index.listBySourceKey("src/a.png");
    expect(aVariants).toHaveLength(2);
    const mimeTypes = aVariants.map((v) => v.mimeType).sort();
    expect(mimeTypes).toEqual(["image/avif", "image/webp"]);
  });

  it("removeByCacheKey returns true on delete, false on missing row", async () => {
    const { prisma } = fakePrisma();
    const index = new PrismaVariantCacheIndex(prisma);
    await index.record(entry("ck1", "src/a.png"));
    expect(await index.removeByCacheKey("ck1")).toBe(true);
    expect(await index.removeByCacheKey("ck1")).toBe(false);
    expect(await index.removeByCacheKey("never-existed")).toBe(false);
  });

  it("removeBySourceKey reads cacheKeys before deleteMany, returns the cascade list, and isolates other sources", async () => {
    const { prisma, captured } = fakePrisma();
    const index = new PrismaVariantCacheIndex(prisma);
    await index.record(entry("ck1", "src/a.png"));
    await index.record(entry("ck2", "src/a.png"));
    await index.record(entry("ck3", "src/b.png"));

    const cascade = await index.removeBySourceKey("src/a.png");
    expect(cascade.sort()).toEqual(["ck1", "ck2"]);
    expect(captured.deleteMany).toHaveLength(1);
    expect((captured.deleteMany[0] as { where: { sourceKey: string } }).where.sourceKey).toBe(
      "src/a.png",
    );
    // Other sources untouched
    const survivors = await index.listBySourceKey("src/b.png");
    expect(survivors).toHaveLength(1);
  });

  it("removeBySourceKey returns empty array + skips deleteMany when no rows match (saves a round-trip)", async () => {
    const { prisma, captured } = fakePrisma();
    const index = new PrismaVariantCacheIndex(prisma);
    await index.record(entry("ck1", "src/a.png"));

    const cascade = await index.removeBySourceKey("missing");
    expect(cascade).toEqual([]);
    expect(captured.deleteMany).toHaveLength(0);
  });

  it("getStats sums sizeBytes via prisma.aggregate and returns the entryCount via prisma.count", async () => {
    const { prisma } = fakePrisma();
    const index = new PrismaVariantCacheIndex(prisma);
    await index.record(entry("ck1", "src/a.png", { sizeBytes: 100 }));
    await index.record(entry("ck2", "src/a.png", { sizeBytes: 200 }));
    await index.record(entry("ck3", "src/b.png", { sizeBytes: 500 }));

    const stats = await index.getStats();
    expect(stats.entryCount).toBe(3);
    expect(stats.totalBytes).toBe(800);
  });

  it("getStats returns 0/0 on an empty index without throwing on prisma.aggregate's null _sum", async () => {
    const { prisma } = fakePrisma();
    const index = new PrismaVariantCacheIndex(prisma);
    const stats = await index.getStats();
    expect(stats.entryCount).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });

  it("hasPrismaVariantIndexDelegate detects the runtime delegate (true) and its absence (false)", () => {
    const withDelegate = { assetVariantIndex: {} } as unknown as PrismaService;
    expect(hasPrismaVariantIndexDelegate(withDelegate)).toBe(true);
    const withoutDelegate = {} as unknown as PrismaService;
    expect(hasPrismaVariantIndexDelegate(withoutDelegate)).toBe(false);
    const withNullDelegate = { assetVariantIndex: null } as unknown as PrismaService;
    expect(hasPrismaVariantIndexDelegate(withNullDelegate)).toBe(false);
  });

  it("record is idempotent on cacheKey — second call upserts without throwing", async () => {
    const { prisma, captured } = fakePrisma();
    const index = new PrismaVariantCacheIndex(prisma);
    await index.record(entry("ck1", "src/a.png", { sizeBytes: 100 }));
    await index.record(entry("ck1", "src/a.png", { sizeBytes: 200 }));
    expect(captured.upsert).toHaveLength(2);
    const stats = await index.getStats();
    expect(stats.entryCount).toBe(1);
    expect(stats.totalBytes).toBe(200);
  });
});
