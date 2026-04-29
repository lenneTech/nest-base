import { Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';

import { AddressController } from './address.controller.js';
import { GeoController } from './geo.controller.js';
import {
  DEFAULT_GEOCODING_CACHE_RETENTION_DAYS,
  buildGeocodingCleanupPlan,
} from './geocoding-cache-cleanup.js';
import { GeoService, type GeocodingCacheStore } from './geo-service.js';
import { LocalStubGeocodingProvider } from './geocoding-providers.js';

const GEO_SERVICE = GeoService;

class InMemoryGeocodingCache implements GeocodingCacheStore {
  private readonly map = new Map<string, { payload: unknown; expiresAt: number }>();
  async get(provider: string, queryHash: string) {
    return this.map.get(`${provider}:${queryHash}`) ?? null;
  }
  async put(provider: string, queryHash: string, payload: unknown, expiresAt: number) {
    this.map.set(`${provider}:${queryHash}`, { payload, expiresAt });
  }
}

/**
 * GeocodingCacheCleanupCron — runs `buildGeocodingCleanupPlan()` once
 * on boot and then every 24h. The plan is logged; once the Prisma
 * `GeocodingCache` model is in DI, the runner executes the planned
 * `DELETE` against the table. Until then this is a noop but the
 * lifecycle hook is in place so consumers see one less moving part
 * to wire up.
 */
@Injectable()
class GeocodingCacheCleanupCron implements OnModuleInit {
  private readonly logger = new Logger('GeocodingCacheCleanup');
  private timer?: ReturnType<typeof setInterval>;

  onModuleInit(): void {
    this.runOnce();
    // 24h; setInterval keeps the process alive — fine for a long-
    // running server, irrelevant for tests (Vitest tears down before
    // the first tick).
    this.timer = setInterval(() => this.runOnce(), 24 * 60 * 60 * 1000);
  }

  /** Public so tests can call it deterministically. */
  runOnce(): void {
    const plan = buildGeocodingCleanupPlan({
      now: Date.now(),
      retentionDays: DEFAULT_GEOCODING_CACHE_RETENTION_DAYS,
    });
    this.logger.log(`cleanup-plan: cutoffMs=${plan.cutoffMs} cutoffIso=${plan.cutoffIso}`);
    // Real DELETE happens once `GeocodingCache` Prisma model is wired.
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
 * via `features.geo.provider`. Cache: in-memory by default;
 * Postgres-backed adapter follows.
 */
@Module({
  controllers: [GeoController, AddressController],
  providers: [
    {
      provide: GEO_SERVICE,
      useFactory: () =>
        new GeoService({
          provider: new LocalStubGeocodingProvider({ seedFixtures: [] }),
          cache: new InMemoryGeocodingCache(),
          now: () => Date.now(),
          ttlMs: 90 * 24 * 60 * 60 * 1000, // 90 days (PLAN §15.4)
        }),
    },
    GeocodingCacheCleanupCron,
  ],
  exports: [GEO_SERVICE],
})
export class GeoModule {}
