import { describe, expect, it, vi } from "vitest";

import {
  GeoService,
  GeocodingProviderMissingError,
  buildFindNearbyQuery,
  buildWithinGeofenceQuery,
  haversineDistanceMeters,
  type GeocodingCacheStore,
} from "../../src/core/geo/geo-service.js";
import type { GeocodingProvider, GeocodingResult } from "../../src/core/geo/geocoding-providers.js";

/**
 * Story · GeoService.
 *
 * Cache-aware façade over the GeocodingProvider adapters plus three
 * pure helpers (`haversineDistanceMeters`, `buildFindNearbyQuery`,
 * `buildWithinGeofenceQuery`) for the spatial query shapes
 * downstream services use.
 */
describe("Story · GeoService", () => {
  function fakeProvider(
    name: string,
    result: GeocodingResult | null,
  ): GeocodingProvider & { calls: string[] } {
    const calls: string[] = [];
    return {
      name,
      calls,
      async geocode(query) {
        calls.push(query);
        return result;
      },
      async reverseGeocode() {
        return result;
      },
    };
  }

  function inMemoryCache(): GeocodingCacheStore & {
    records: Map<string, { payload: unknown; expiresAt: number }>;
  } {
    const records = new Map<string, { payload: unknown; expiresAt: number }>();
    return {
      records,
      async get(provider, queryHash) {
        const r = records.get(`${provider}::${queryHash}`);
        return r ? { payload: r.payload, expiresAt: r.expiresAt } : null;
      },
      async put(provider, queryHash, payload, expiresAt) {
        records.set(`${provider}::${queryHash}`, { payload, expiresAt });
      },
    };
  }

  describe("geocode()", () => {
    it("delegates to the provider on a cache miss", async () => {
      const provider = fakeProvider("local", { lat: 52.52, lng: 13.405, formatted: "Berlin" });
      const cache = inMemoryCache();
      const svc = new GeoService({ provider, cache, now: () => 0, ttlMs: 60_000 });
      const out = await svc.geocode("Berlin");
      expect(out).toMatchObject({ lat: 52.52, lng: 13.405, formatted: "Berlin" });
      expect(provider.calls).toEqual(["Berlin"]);
    });

    it("caches the result so a second call skips the provider", async () => {
      const provider = fakeProvider("local", { lat: 52.52, lng: 13.405, formatted: "Berlin" });
      const cache = inMemoryCache();
      const svc = new GeoService({ provider, cache, now: () => 0, ttlMs: 60_000 });
      await svc.geocode("Berlin");
      await svc.geocode("Berlin");
      expect(provider.calls).toEqual(["Berlin"]);
    });

    it("passes the cache when the entry expired", async () => {
      const provider = fakeProvider("local", { lat: 52.52, lng: 13.405, formatted: "Berlin" });
      const cache = inMemoryCache();
      let now = 0;
      const svc = new GeoService({ provider, cache, now: () => now, ttlMs: 60_000 });
      await svc.geocode("Berlin");
      now = 60_001;
      await svc.geocode("Berlin");
      expect(provider.calls).toEqual(["Berlin", "Berlin"]);
    });

    it("does not cache a null result (so a transient outage is retried)", async () => {
      const provider = fakeProvider("local", null);
      const cache = inMemoryCache();
      const svc = new GeoService({ provider, cache, now: () => 0, ttlMs: 60_000 });
      await svc.geocode("Atlantis");
      await svc.geocode("Atlantis");
      expect(provider.calls).toEqual(["Atlantis", "Atlantis"]);
    });

    it("throws GeocodingProviderMissingError when no provider is wired", async () => {
      const cache = inMemoryCache();
      const svc = new GeoService({ provider: undefined, cache, now: () => 0, ttlMs: 60_000 });
      await expect(svc.geocode("x")).rejects.toThrow(GeocodingProviderMissingError);
    });
  });

  describe("reverseGeocode()", () => {
    it("delegates to the provider", async () => {
      const provider = fakeProvider("local", { lat: 52.52, lng: 13.405, formatted: "Berlin" });
      const reverseSpy = vi.fn(provider.reverseGeocode.bind(provider));
      provider.reverseGeocode = reverseSpy;
      const svc = new GeoService({ provider, cache: inMemoryCache(), now: () => 0, ttlMs: 60_000 });
      await svc.reverseGeocode(52.52, 13.405);
      expect(reverseSpy).toHaveBeenCalledWith(52.52, 13.405);
    });
  });

  describe("haversineDistanceMeters()", () => {
    it("returns ~0 for identical coordinates", () => {
      expect(haversineDistanceMeters(52.52, 13.405, 52.52, 13.405)).toBeLessThan(1);
    });

    it("returns the canonical Berlin↔Hamburg distance (~255 km)", () => {
      const meters = haversineDistanceMeters(52.52, 13.405, 53.55, 9.99);
      expect(meters / 1000).toBeGreaterThan(250);
      expect(meters / 1000).toBeLessThan(260);
    });

    it("is symmetric (a→b == b→a)", () => {
      const ab = haversineDistanceMeters(52.52, 13.405, 53.55, 9.99);
      const ba = haversineDistanceMeters(53.55, 9.99, 52.52, 13.405);
      expect(ab).toBeCloseTo(ba, 5);
    });
  });

  describe("buildFindNearbyQuery()", () => {
    const TENANT = "11111111-1111-4111-8111-111111111111";

    it("produces a ST_DWithin filter on the location column", () => {
      const sql = buildFindNearbyQuery({
        table: "addresses",
        tenantId: TENANT,
        lat: 52.52,
        lng: 13.405,
        radiusMeters: 1000,
      });
      expect(sql).toMatch(/ST_DWithin/i);
      expect(sql).toContain("addresses");
      expect(sql).toContain("1000");
    });

    it("embeds the centre point as ST_MakePoint(lng, lat) (PostGIS axis order)", () => {
      const sql = buildFindNearbyQuery({
        table: "addresses",
        tenantId: TENANT,
        lat: 52.52,
        lng: 13.405,
        radiusMeters: 500,
      });
      expect(sql).toMatch(/ST_MakePoint\(13\.405,\s*52\.52\)/);
    });

    it("uses ::geography so the radius is in metres (not degrees)", () => {
      const sql = buildFindNearbyQuery({
        table: "addresses",
        tenantId: TENANT,
        lat: 52.52,
        lng: 13.405,
        radiusMeters: 100,
      });
      expect(sql).toContain("::geography");
    });

    it("rejects a non-positive radius", () => {
      expect(() =>
        buildFindNearbyQuery({
          table: "addresses",
          tenantId: TENANT,
          lat: 0,
          lng: 0,
          radiusMeters: 0,
        }),
      ).toThrow(/radius/i);
    });

    it("rejects a missing or non-UUID tenantId (iter-205 reviewer-G5)", () => {
      expect(() =>
        buildFindNearbyQuery({
          table: "addresses",
          tenantId: "",
          lat: 0,
          lng: 0,
          radiusMeters: 100,
        }),
      ).toThrow(/tenantId/i);
      expect(() =>
        buildFindNearbyQuery({
          table: "addresses",
          tenantId: "not-a-uuid",
          lat: 0,
          lng: 0,
          radiusMeters: 100,
        }),
      ).toThrow(/UUID/);
    });

    it("emits a tenantId predicate before the spatial filter (iter-205 reviewer-G5)", () => {
      const sql = buildFindNearbyQuery({
        table: "addresses",
        tenantId: TENANT,
        lat: 52.52,
        lng: 13.405,
        radiusMeters: 100,
      });
      // Tenant predicate sits BEFORE the spatial filter so the planner
      // can prune by index before evaluating ST_DWithin on each row.
      expect(sql).toMatch(/"tenantId"\s*=\s*'11111111-1111-4111-8111-111111111111'/);
      const tenantIdx = sql.indexOf('"tenantId"');
      const dwithinIdx = sql.indexOf("ST_DWithin");
      expect(tenantIdx).toBeGreaterThan(0);
      expect(tenantIdx).toBeLessThan(dwithinIdx);
    });

    it("respects an override tenantColumn for snake_case domains", () => {
      const sql = buildFindNearbyQuery({
        table: "places",
        tenantId: TENANT,
        tenantColumn: "tenant_id",
        lat: 0,
        lng: 0,
        radiusMeters: 100,
      });
      expect(sql).toMatch(/"tenant_id"\s*=\s*'11111111-1111-4111-8111-111111111111'/);
    });
  });

  describe("buildWithinGeofenceQuery()", () => {
    const TENANT = "11111111-1111-4111-8111-111111111111";
    const GEOFENCE = "22222222-2222-4222-8222-222222222222";

    it("produces a ST_Contains filter referencing the geofence", () => {
      const sql = buildWithinGeofenceQuery({
        pointTable: "addresses",
        geofenceTable: "geofences",
        geofenceId: GEOFENCE,
        tenantId: TENANT,
      });
      expect(sql).toMatch(/ST_Contains/i);
      expect(sql).toContain("addresses");
      expect(sql).toContain("geofences");
      expect(sql).toContain(GEOFENCE);
    });

    it("rejects a missing or non-UUID tenantId (iter-205 reviewer-flagged sibling)", () => {
      expect(() =>
        buildWithinGeofenceQuery({
          pointTable: "addresses",
          geofenceTable: "geofences",
          geofenceId: GEOFENCE,
          tenantId: "",
        }),
      ).toThrow(/tenantId/i);
      expect(() =>
        buildWithinGeofenceQuery({
          pointTable: "addresses",
          geofenceTable: "geofences",
          geofenceId: GEOFENCE,
          tenantId: "not-a-uuid",
        }),
      ).toThrow(/UUID/);
    });

    it("rejects a missing or non-UUID geofenceId (SQL-smuggling guard)", () => {
      expect(() =>
        buildWithinGeofenceQuery({
          pointTable: "addresses",
          geofenceTable: "geofences",
          geofenceId: "",
          tenantId: TENANT,
        }),
      ).toThrow(/geofenceId/i);
      expect(() =>
        buildWithinGeofenceQuery({
          pointTable: "addresses",
          geofenceTable: "geofences",
          geofenceId: "'; DROP TABLE--",
          tenantId: TENANT,
        }),
      ).toThrow(/UUID/);
    });

    it("emits tenantId predicates on BOTH the point AND geofence tables before the spatial filter", () => {
      const sql = buildWithinGeofenceQuery({
        pointTable: "addresses",
        geofenceTable: "geofences",
        geofenceId: GEOFENCE,
        tenantId: TENANT,
      });
      expect(sql).toMatch(new RegExp(`g\\."tenantId"\\s*=\\s*'${TENANT}'`));
      expect(sql).toMatch(new RegExp(`p\\."tenantId"\\s*=\\s*'${TENANT}'`));
      const tenantIdx = sql.indexOf('"tenantId"');
      const containsIdx = sql.indexOf("ST_Contains");
      expect(tenantIdx).toBeGreaterThan(0);
      expect(tenantIdx).toBeLessThan(containsIdx);
    });

    it("respects an override tenantColumn for snake_case domains", () => {
      const sql = buildWithinGeofenceQuery({
        pointTable: "places",
        geofenceTable: "areas",
        geofenceId: GEOFENCE,
        tenantId: TENANT,
        tenantColumn: "tenant_id",
      });
      expect(sql).toMatch(/g\."tenant_id"\s*=\s*'/);
      expect(sql).toMatch(/p\."tenant_id"\s*=\s*'/);
    });
  });
});
