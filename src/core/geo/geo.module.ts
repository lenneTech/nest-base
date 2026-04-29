import { Module } from '@nestjs/common';

import { GeoController } from './geo.controller.js';
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
 * GeoModule — provides the `GeoService` plus controllers for
 * `/geo/geocode`, `/geo/reverse-geocode`, `/places/nearby`,
 * `/addresses`, `/geofences`.
 *
 * Provider: defaults to the local stub (no network, deterministic).
 * Real providers (Mapbox/Nominatim/Google) get plugged in via
 * `features.geo.provider` once their HTTP-client config is wired
 * from env-vars. Cache: in-memory map by default; Postgres-backed
 * adapter follows in a separate slice.
 */
@Module({
  controllers: [GeoController],
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
  ],
  exports: [GEO_SERVICE],
})
export class GeoModule {}
