import type { PrismaService } from "../prisma/prisma.service.js";
import type { GeocodingCacheStore } from "./geo-service.js";

/**
 * Prisma-backed `GeocodingCacheStore` (CF.STORAGE.01 closure —
 * iter-172).
 *
 * The `GeocodingCache` Prisma model lives at
 * `prisma/features/geo.prisma`. Schema columns: `(provider,
 * queryHash)` is the unique-key tuple; `payload` is the upstream
 * provider's raw response JSON; `expiresAt` is a `DateTime`. The
 * `GeocodingCacheStore` interface uses ms-since-epoch for
 * `expiresAt` so the cache abstraction stays time-source-agnostic
 * (the cron + the `now: () => number` injection in `GeoService` use
 * `Date.now()`); this adapter converts ms ↔ `DateTime` at the
 * boundary.
 */

interface PrismaGeocodingCacheRow {
  id: string;
  provider: string;
  queryHash: string;
  payload: unknown;
  expiresAt: Date;
  createdAt: Date;
}

interface PrismaGeocodingCacheDelegate {
  findUnique(input: {
    where: { provider_queryHash: { provider: string; queryHash: string } };
  }): Promise<PrismaGeocodingCacheRow | null>;
  upsert(input: {
    where: { provider_queryHash: { provider: string; queryHash: string } };
    create: {
      provider: string;
      queryHash: string;
      payload: unknown;
      expiresAt: Date;
    };
    update: {
      payload: unknown;
      expiresAt: Date;
    };
  }): Promise<PrismaGeocodingCacheRow>;
  deleteMany(input: {
    where: { OR: Array<{ createdAt?: { lt: Date }; expiresAt?: { lt: Date } }> };
  }): Promise<{ count: number }>;
}

interface PrismaGeocodingCacheClient {
  geocodingCache: PrismaGeocodingCacheDelegate;
}

export class PrismaGeocodingCache implements GeocodingCacheStore {
  constructor(private readonly prisma: PrismaService) {}

  async get(
    provider: string,
    queryHash: string,
  ): Promise<{ payload: unknown; expiresAt: number } | null> {
    const row = await this.client().geocodingCache.findUnique({
      where: { provider_queryHash: { provider, queryHash } },
    });
    if (row === null) return null;
    return {
      payload: row.payload,
      expiresAt: row.expiresAt.getTime(),
    };
  }

  async put(
    provider: string,
    queryHash: string,
    payload: unknown,
    expiresAt: number,
  ): Promise<void> {
    const expiresDate = new Date(expiresAt);
    await this.client().geocodingCache.upsert({
      where: { provider_queryHash: { provider, queryHash } },
      create: { provider, queryHash, payload, expiresAt: expiresDate },
      update: { payload, expiresAt: expiresDate },
    });
  }

  /**
   * Delete cache entries older than `cutoff` (Unix-millis). Returns
   * the number of rows removed so the cron can log a meaningful
   * "cleaned N rows" message.
   *
   * The WHERE matches the planner's contract: `createdAt < cutoff
   * OR expiresAt < cutoff`. A row that was inserted with a custom
   * shorter `expiresAt` gets cleaned even if it's younger than the
   * retention window.
   */
  async deleteOlderThan(cutoffMs: number): Promise<number> {
    const cutoff = new Date(cutoffMs);
    const result = await this.client().geocodingCache.deleteMany({
      where: {
        OR: [{ createdAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
      },
    });
    return result.count;
  }

  /**
   * Type-erasing bridge: the project's `PrismaService` extends
   * `PrismaClient`. The `geocodingCache` delegate is structurally
   * compatible with `PrismaGeocodingCacheDelegate` once the geo
   * feature schema is loaded into the concatenated schema.
   */
  private client(): PrismaGeocodingCacheClient {
    const erased: unknown = this.prisma;
    return erased as PrismaGeocodingCacheClient;
  }
}
