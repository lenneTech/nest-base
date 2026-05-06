import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { AddressController } from "./address.controller.js";
import {
  ADDRESS_STORAGE,
  InMemoryAddressStorage,
  PrismaAddressStorage,
} from "./address-storage.js";
import { GeoController } from "./geo.controller.js";
import {
  DEFAULT_GEOCODING_CACHE_RETENTION_DAYS,
  buildGeocodingCleanupPlan,
} from "./geocoding-cache-cleanup.js";
import { PrismaGeocodingCache } from "./geocoding-cache.prisma.js";
import { GeoService, type GeocodingCacheStore } from "./geo-service.js";
import { selectGeocodingProvider } from "./geocoding-providers.js";
import { loadFeatures } from "../features/features.js";
import { PrismaService } from "../prisma/prisma.service.js";

const GEO_SERVICE = GeoService;
const GEOCODING_CACHE = Symbol.for("lt:GeocodingCacheStore");

/**
 * Detect whether the Prisma client was generated with the geo
 * schema concatenated in (the `geocodingCache` / `address` delegates
 * appear on the runtime client only when `features.geo.enabled=true`
 * was set at `bun run prepare:schema && bunx prisma generate` time).
 *
 * The factory below uses these to decide between the Prisma adapter
 * and the in-memory fallback at runtime. Without this guard, a test
 * that flips the feature flag via `process.env` would call into a
 * delegate that doesn't exist at runtime → 500 on every cache read.
 */
function hasPrismaGeocodingCacheDelegate(prisma: PrismaService): boolean {
  const erased: unknown = prisma;
  const client = erased as { geocodingCache?: unknown };
  return typeof client.geocodingCache === "object" && client.geocodingCache !== null;
}

function hasPrismaAddressDelegate(prisma: PrismaService): boolean {
  const erased: unknown = prisma;
  const client = erased as { address?: unknown };
  return typeof client.address === "object" && client.address !== null;
}

class InMemoryGeocodingCache implements GeocodingCacheStore {
  private readonly map = new Map<string, { payload: unknown; expiresAt: number }>();
  async get(provider: string, queryHash: string) {
    return this.map.get(`${provider}:${queryHash}`) ?? null;
  }
  async put(provider: string, queryHash: string, payload: unknown, expiresAt: number) {
    this.map.set(`${provider}:${queryHash}`, { payload, expiresAt });
  }

  /** Iter-172: in-memory cache participates in the cleanup contract.
   * Returns the count of evicted entries so the cron + cleanup
   * tests can assert deterministically. */
  async deleteOlderThan(cutoffMs: number): Promise<number> {
    let count = 0;
    for (const [key, value] of this.map.entries()) {
      if (value.expiresAt < cutoffMs) {
        this.map.delete(key);
        count++;
      }
    }
    return count;
  }
}

/**
 * Optional cleanup hook — both adapters expose `deleteOlderThan`,
 * but the `GeocodingCacheStore` interface intentionally keeps it
 * off the public contract so the GeoService stays narrow. The cron
 * type-narrows when the bound adapter exposes the method.
 */
interface GeocodingCacheCleanup {
  deleteOlderThan(cutoffMs: number): Promise<number>;
}

function isCleanupCapable(store: unknown): store is GeocodingCacheCleanup {
  return (
    typeof store === "object" &&
    store !== null &&
    typeof (store as { deleteOlderThan?: unknown }).deleteOlderThan === "function"
  );
}

/**
 * GeocodingCacheCleanupCron — runs `buildGeocodingCleanupPlan()`
 * once on boot and then every 24h. Iter-172 wires the actual
 * `deleteMany` against the bound store: when the Prisma adapter
 * is bound, the cron deletes rows whose `createdAt < cutoff OR
 * expiresAt < cutoff`; when the in-memory adapter is bound, the
 * Map prunes its entries the same way. The `deleteOlderThan`
 * method is detected via duck-typing so an adapter without it
 * (legacy seam) falls back to log-only.
 */
@Injectable()
class GeocodingCacheCleanupCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("GeocodingCacheCleanup");
  private timer?: ReturnType<typeof setInterval>;

  constructor(@Inject(GEOCODING_CACHE) private readonly store: GeocodingCacheStore) {}

  onModuleInit(): void {
    void this.runOnce();
    // 24h; setInterval keeps the process alive — fine for a long-
    // running server, irrelevant for tests (Vitest tears down before
    // the first tick).
    this.timer = setInterval(() => void this.runOnce(), 24 * 60 * 60 * 1000);
  }

  /** Public so tests can call it deterministically. */
  async runOnce(): Promise<{ cutoffMs: number; deleted: number | null }> {
    const plan = buildGeocodingCleanupPlan({
      now: Date.now(),
      retentionDays: DEFAULT_GEOCODING_CACHE_RETENTION_DAYS,
    });
    if (!isCleanupCapable(this.store)) {
      this.logger.log(
        `cleanup-plan: cutoffMs=${plan.cutoffMs} cutoffIso=${plan.cutoffIso} (store has no deleteOlderThan; logging only)`,
      );
      return { cutoffMs: plan.cutoffMs, deleted: null };
    }
    try {
      const deleted = await this.store.deleteOlderThan(plan.cutoffMs);
      this.logger.log(
        `cleanup-run: cutoffMs=${plan.cutoffMs} cutoffIso=${plan.cutoffIso} deleted=${deleted}`,
      );
      return { cutoffMs: plan.cutoffMs, deleted };
    } catch (err) {
      // Per-tick error isolation — a transient DB outage MUST NOT
      // crash-loop the process. Sibling crons (idempotency, variant)
      // share this contract; surface { deleted: null } so observability
      // has one signal across all three.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`cleanup-error: cutoffMs=${plan.cutoffMs} error="${msg}"`);
      return { cutoffMs: plan.cutoffMs, deleted: null };
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

/**
 * GeoModule — provides `GeoService` + GeoController + cleanup cron.
 *
 * Provider default: `LocalStubGeocodingProvider` (deterministic, no
 * network). Real providers (Mapbox/Nominatim/Google) are selected
 * via `features.geo.provider`. Cache: Prisma-backed when
 * `features.geo.enabled=true` (the matching `GeocodingCache` model
 * loads from `prisma/features/geo.prisma`); in-memory fallback
 * otherwise.
 */
@Module({
  controllers: [GeoController, AddressController],
  providers: [
    {
      // Iter-172: closes CF.STORAGE.01 line item (b)+(c). Production
      // binds the Prisma adapter when `features.geo.enabled=true`
      // AND the Prisma client was generated with the geo schema (the
      // `geocodingCache` delegate exists at runtime). Tests + projects
      // that flip the feature flag at runtime without re-generating
      // the Prisma client fall back to the in-memory adapter so the
      // controller path stays bootable. Both adapters implement
      // `deleteOlderThan` so the cleanup cron behaves identically.
      provide: GEOCODING_CACHE,
      useFactory: (prisma: PrismaService) => {
        const features = loadFeatures(process.env);
        if (!features.geo.enabled) return new InMemoryGeocodingCache();
        if (!hasPrismaGeocodingCacheDelegate(prisma)) return new InMemoryGeocodingCache();
        return new PrismaGeocodingCache(prisma);
      },
      inject: [PrismaService],
    },
    {
      provide: GEO_SERVICE,
      useFactory: (cache: GeocodingCacheStore) => {
        const features = loadFeatures(process.env);
        const provider = selectGeocodingProvider({
          provider: features.geo.provider,
          env: process.env as Record<string, string | undefined>,
        });
        return new GeoService({
          provider,
          cache,
          now: () => Date.now(),
          ttlMs: 90 * 24 * 60 * 60 * 1000, // 90-day GeocodingCache TTL
        });
      },
      inject: [GEOCODING_CACHE],
    },
    {
      // Iter-169: closes CF.STORAGE.01 line item (f). Production
      // binds the Prisma adapter when `features.geo.enabled=true`
      // (the `Address` Prisma model loads from `prisma/features/
      // geo.prisma`); otherwise we fall back to the in-memory
      // adapter so the controller stays bootable for projects that
      // haven't enabled the geo feature.
      provide: ADDRESS_STORAGE,
      useFactory: (prisma: PrismaService) => {
        const features = loadFeatures(process.env);
        if (!features.geo.enabled) return new InMemoryAddressStorage();
        if (!hasPrismaAddressDelegate(prisma)) return new InMemoryAddressStorage();
        return new PrismaAddressStorage(prisma);
      },
      inject: [PrismaService],
    },
    GeocodingCacheCleanupCron,
  ],
  exports: [GEO_SERVICE, ADDRESS_STORAGE, GEOCODING_CACHE],
})
export class GeoModule {}

// Iter-172: exported so story tests can construct an isolated
// in-memory cache + cron pair to exercise the cleanup contract.
export { GeocodingCacheCleanupCron, InMemoryGeocodingCache, GEOCODING_CACHE };
