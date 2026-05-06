import type { PrismaService } from "../prisma/prisma.service.js";
import type {
  VariantCacheEntry,
  VariantCacheIndex,
  VariantCacheIndexStats,
} from "./variant-cache-index.js";

/**
 * Prisma-backed `VariantCacheIndex` (CF.STORAGE.01 final closure —
 * iter-183).
 *
 * Persists variant entries to the `asset_variant_index` table. The
 * `source_key` index from migration `20260506120000_asset_variant_index`
 * makes `removeBySourceKey` O(log N).
 *
 * The matching in-memory adapter still ships in `variant-cache-index.ts`;
 * the FilesModule's factory picks Prisma when the delegate is
 * detected on `PrismaService` and falls back to in-memory when not
 * (mirrors the idempotency / geocoding-cache patterns).
 */

interface PrismaVariantIndexDelegate {
  upsert(input: {
    where: { cacheKey: string };
    create: PrismaVariantIndexRow;
    update: Partial<PrismaVariantIndexRow>;
  }): Promise<PrismaVariantIndexRow>;
  findMany(input: { where: { sourceKey: string } }): Promise<PrismaVariantIndexRow[]>;
  delete(input: { where: { cacheKey: string } }): Promise<PrismaVariantIndexRow>;
  deleteMany(input: {
    where: { sourceKey: string } | { createdAt: { lt: Date } };
  }): Promise<{ count: number }>;
  count(): Promise<number>;
  aggregate(input: { _sum: { sizeBytes: true } }): Promise<{ _sum: { sizeBytes: number | null } }>;
}

interface PrismaVariantIndexClient {
  assetVariantIndex: PrismaVariantIndexDelegate;
}

interface PrismaVariantIndexRow {
  cacheKey: string;
  sourceKey: string;
  optionsHash: string;
  mimeType: string;
  sizeBytes: number;
  createdAt?: Date;
}

export class PrismaVariantCacheIndex implements VariantCacheIndex {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: VariantCacheEntry): Promise<void> {
    const row = this.toRow(entry);
    await this.client().assetVariantIndex.upsert({
      where: { cacheKey: row.cacheKey },
      create: row,
      update: {
        sourceKey: row.sourceKey,
        optionsHash: row.optionsHash,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
      },
    });
  }

  async listBySourceKey(sourceKey: string): Promise<VariantCacheEntry[]> {
    const rows = await this.client().assetVariantIndex.findMany({ where: { sourceKey } });
    return rows.map((r) => this.fromRow(r));
  }

  async removeByCacheKey(cacheKey: string): Promise<boolean> {
    try {
      await this.client().assetVariantIndex.delete({ where: { cacheKey } });
      return true;
    } catch {
      return false;
    }
  }

  async removeBySourceKey(sourceKey: string): Promise<string[]> {
    // The cascade returns the list of cacheKeys to drop — we need
    // them BEFORE the delete fires so the AssetService can drop the
    // matching bytes from the StorageAdapter cache. Two-step: read
    // the rows, then deleteMany. Race-tolerant: a concurrent record()
    // with the same sourceKey will land after our findMany and
    // before our deleteMany — its cacheKey gets dropped too, but
    // we don't return it. AssetService's caller treats invalidation
    // as eventually-consistent so this is fine.
    const rows = await this.client().assetVariantIndex.findMany({ where: { sourceKey } });
    const cascade = rows.map((r) => r.cacheKey);
    if (cascade.length > 0) {
      await this.client().assetVariantIndex.deleteMany({ where: { sourceKey } });
    }
    return cascade;
  }

  async getStats(): Promise<VariantCacheIndexStats> {
    const [entryCount, agg] = await Promise.all([
      this.client().assetVariantIndex.count(),
      this.client().assetVariantIndex.aggregate({ _sum: { sizeBytes: true } }),
    ]);
    return { entryCount, totalBytes: agg._sum.sizeBytes ?? 0 };
  }

  /**
   * Cleanup-cron entry point — delete every row whose `createdAt`
   * is older than `cutoffMs`. Mirrors `PrismaIdempotencyStore.deleteOlderThan`.
   * The matching `@@index([createdAt])` (migration
   * `20260506140000_asset_variant_index_created_at`) makes the
   * prune O(log N).
   */
  async deleteOlderThan(cutoffMs: number): Promise<number> {
    const result = await this.client().assetVariantIndex.deleteMany({
      where: { createdAt: { lt: new Date(cutoffMs) } },
    });
    return result.count;
  }

  private client(): PrismaVariantIndexClient {
    const erased: unknown = this.prisma;
    return erased as PrismaVariantIndexClient;
  }

  private toRow(entry: VariantCacheEntry): PrismaVariantIndexRow {
    return {
      cacheKey: entry.cacheKey,
      sourceKey: entry.sourceKey,
      optionsHash: entry.optionsHash,
      mimeType: entry.mimeType,
      sizeBytes: entry.sizeBytes,
      createdAt: entry.createdAt,
    };
  }

  private fromRow(row: PrismaVariantIndexRow): VariantCacheEntry {
    return {
      cacheKey: row.cacheKey,
      sourceKey: row.sourceKey,
      optionsHash: row.optionsHash,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt ?? new Date(),
    };
  }
}

/**
 * Runtime feature-detection — returns true when the resolved Prisma
 * client exposes the `assetVariantIndex` delegate. Tests that flip
 * the feature flag without regenerating the Prisma client land in
 * the false branch and the FilesModule falls back to in-memory.
 */
export function hasPrismaVariantIndexDelegate(prisma: PrismaService): boolean {
  const erased: unknown = prisma;
  const client = erased as { assetVariantIndex?: unknown };
  return typeof client.assetVariantIndex === "object" && client.assetVariantIndex !== null;
}
