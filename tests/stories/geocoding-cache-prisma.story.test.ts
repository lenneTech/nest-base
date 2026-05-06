import { describe, expect, it } from "vitest";

import { PrismaGeocodingCache } from "../../src/core/geo/geocoding-cache.prisma.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Story · `PrismaGeocodingCache` (CF.STORAGE.01 closure — iter-172).
 *
 * The `GeocodingCache` Prisma model lives at
 * `prisma/features/geo.prisma`. Iter-172 introduces a Prisma-backed
 * adapter that replaces the `InMemoryGeocodingCache` default in
 * production. The story drives the adapter against a fake
 * `prisma.geocodingCache` delegate so the mapping logic + ms↔Date
 * conversion are locked without spinning up Postgres.
 */
describe("Story · PrismaGeocodingCache delegates to prisma.geocodingCache (iter-172)", () => {
  function fakePrisma(): {
    prisma: PrismaService;
    rows: Map<
      string,
      { provider: string; queryHash: string; payload: unknown; expiresAt: Date; createdAt: Date }
    >;
  } {
    const rows = new Map<
      string,
      { provider: string; queryHash: string; payload: unknown; expiresAt: Date; createdAt: Date }
    >();
    const fake = {
      geocodingCache: {
        async findUnique(input: {
          where: { provider_queryHash: { provider: string; queryHash: string } };
        }) {
          const key = `${input.where.provider_queryHash.provider}:${input.where.provider_queryHash.queryHash}`;
          const r = rows.get(key);
          return r ? { id: key, ...r } : null;
        },
        async upsert(input: {
          where: { provider_queryHash: { provider: string; queryHash: string } };
          create: { provider: string; queryHash: string; payload: unknown; expiresAt: Date };
          update: { payload: unknown; expiresAt: Date };
        }) {
          const key = `${input.where.provider_queryHash.provider}:${input.where.provider_queryHash.queryHash}`;
          const existing = rows.get(key);
          if (existing) {
            const next = {
              ...existing,
              payload: input.update.payload,
              expiresAt: input.update.expiresAt,
            };
            rows.set(key, next);
            return { id: key, ...next };
          }
          const next = { ...input.create, createdAt: new Date() };
          rows.set(key, next);
          return { id: key, ...next };
        },
        async deleteMany(input: {
          where: { OR: Array<{ createdAt?: { lt: Date }; expiresAt?: { lt: Date } }> };
        }) {
          let count = 0;
          for (const [key, r] of rows.entries()) {
            const cutoffCreated = input.where.OR.find((c) => c.createdAt)?.createdAt?.lt;
            const cutoffExpires = input.where.OR.find((c) => c.expiresAt)?.expiresAt?.lt;
            const tripsCreated = cutoffCreated !== undefined && r.createdAt < cutoffCreated;
            const tripsExpires = cutoffExpires !== undefined && r.expiresAt < cutoffExpires;
            if (tripsCreated || tripsExpires) {
              rows.delete(key);
              count++;
            }
          }
          return { count };
        },
      },
    };
    return { prisma: fake as unknown as PrismaService, rows };
  }

  it("get returns null when no row matches", async () => {
    const { prisma } = fakePrisma();
    const cache = new PrismaGeocodingCache(prisma);
    expect(await cache.get("nominatim", "h1")).toBeNull();
  });

  it("put + get round-trips with ms↔Date conversion", async () => {
    const { prisma } = fakePrisma();
    const cache = new PrismaGeocodingCache(prisma);
    const expiresMs = Date.now() + 60_000;
    await cache.put("nominatim", "h1", { lat: 52.52, lng: 13.405 }, expiresMs);
    const r = (await cache.get("nominatim", "h1"))!;
    expect(r.expiresAt).toBe(expiresMs);
    expect(r.payload).toEqual({ lat: 52.52, lng: 13.405 });
  });

  it("put upserts: a second put with the same (provider, queryHash) updates payload + expiresAt", async () => {
    const { prisma } = fakePrisma();
    const cache = new PrismaGeocodingCache(prisma);
    await cache.put("nominatim", "h1", { v: 1 }, 1000);
    await cache.put("nominatim", "h1", { v: 2 }, 2000);
    const r = (await cache.get("nominatim", "h1"))!;
    expect(r.payload).toEqual({ v: 2 });
    expect(r.expiresAt).toBe(2000);
  });

  it("different providers don't cross-contaminate the same queryHash", async () => {
    const { prisma } = fakePrisma();
    const cache = new PrismaGeocodingCache(prisma);
    await cache.put("nominatim", "h1", { src: "n" }, 1000);
    await cache.put("mapbox", "h1", { src: "m" }, 1000);
    expect((await cache.get("nominatim", "h1"))!.payload).toEqual({ src: "n" });
    expect((await cache.get("mapbox", "h1"))!.payload).toEqual({ src: "m" });
  });

  it("deleteOlderThan removes rows with createdAt < cutoff or expiresAt < cutoff", async () => {
    const { prisma, rows } = fakePrisma();
    const cache = new PrismaGeocodingCache(prisma);
    const now = Date.now();
    // Old-and-expired
    await cache.put("p", "old", {}, now - 10_000);
    rows.get("p:old")!.createdAt = new Date(now - 100_000_000);
    // Fresh-and-valid
    await cache.put("p", "fresh", {}, now + 10_000_000);
    // Fresh insert but already-expired
    await cache.put("p", "expired", {}, now - 5_000);
    const cutoff = now - 1_000;
    const deleted = await cache.deleteOlderThan(cutoff);
    // The two rows with `expiresAt < cutoff` (old + expired) should be deleted
    expect(deleted).toBeGreaterThanOrEqual(2);
    expect(await cache.get("p", "fresh")).not.toBeNull();
    expect(await cache.get("p", "old")).toBeNull();
    expect(await cache.get("p", "expired")).toBeNull();
  });

  it("deleteOlderThan returns 0 when nothing matches the cutoff", async () => {
    const { prisma } = fakePrisma();
    const cache = new PrismaGeocodingCache(prisma);
    await cache.put("p", "fresh", {}, Date.now() + 10_000_000);
    const deleted = await cache.deleteOlderThan(0);
    expect(deleted).toBe(0);
  });
});
