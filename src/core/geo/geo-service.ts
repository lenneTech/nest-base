import { createHash } from "node:crypto";

import type { GeocodingProvider, GeocodingResult } from "./geocoding-providers.js";

/**
 * GeoService (PLAN.md §15 + §32 Phase 5c).
 *
 * Cache-aware façade over the GeocodingProvider adapters plus three
 * pure SQL builders for the spatial query shapes downstream services
 * use (`findNearby`, `withinGeofence`) and a haversine-distance
 * helper for in-memory bounds checks.
 *
 * Cache semantics:
 *   - hit + not expired  → return cached payload, no provider call
 *   - hit + expired      → call provider, refresh cache
 *   - miss               → call provider, cache the result
 *   - null result        → NOT cached (transient outages stay
 *                           retryable; a confirmed-empty answer
 *                           is the upstream API's job to surface)
 */

export interface GeocodingCacheStore {
  get(provider: string, queryHash: string): Promise<{ payload: unknown; expiresAt: number } | null>;
  put(provider: string, queryHash: string, payload: unknown, expiresAt: number): Promise<void>;
}

export interface GeoServiceOptions {
  provider?: GeocodingProvider;
  cache: GeocodingCacheStore;
  now: () => number;
  ttlMs: number;
}

export class GeocodingProviderMissingError extends Error {
  constructor() {
    super("geo: no GeocodingProvider configured — set features.geo.provider");
    this.name = "GeocodingProviderMissingError";
  }
}

export class GeoService {
  constructor(private readonly opts: GeoServiceOptions) {}

  async geocode(query: string): Promise<GeocodingResult | null> {
    if (!this.opts.provider) throw new GeocodingProviderMissingError();
    const queryHash = sha256(`q:${query}`);
    const now = this.opts.now();
    const cached = await this.opts.cache.get(this.opts.provider.name, queryHash);
    if (cached && cached.expiresAt > now) {
      return cached.payload as GeocodingResult;
    }
    const result = await this.opts.provider.geocode(query);
    if (result) {
      await this.opts.cache.put(this.opts.provider.name, queryHash, result, now + this.opts.ttlMs);
    }
    return result;
  }

  async reverseGeocode(lat: number, lng: number): Promise<GeocodingResult | null> {
    if (!this.opts.provider) throw new GeocodingProviderMissingError();
    return this.opts.provider.reverseGeocode(lat, lng);
  }
}

// ────────────────────────────────────────────────────────────────────
// Pure spatial helpers
// ────────────────────────────────────────────────────────────────────

/** Haversine great-circle distance between two WGS-84 lat/lng pairs, in metres. */
export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000; // mean Earth radius in metres
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface FindNearbyInput {
  table: string;
  lat: number;
  lng: number;
  /** Radius in metres. Must be > 0. */
  radiusMeters: number;
  /** Column holding the geometry; defaults to "location". */
  locationColumn?: string;
}

/**
 * Returns the SQL fragment for a `ST_DWithin` spatial-radius filter.
 * The PostGIS axis order is (lng, lat); the `::geography` cast makes
 * the radius argument metres rather than degrees.
 */
export function buildFindNearbyQuery(input: FindNearbyInput): string {
  if (input.radiusMeters <= 0) {
    throw new Error(`geo: findNearby radius must be > 0 (got ${input.radiusMeters})`);
  }
  const col = input.locationColumn ?? "location";
  return (
    `SELECT * FROM "${input.table}" ` +
    `WHERE ST_DWithin(` +
    `"${col}"::geography, ` +
    `ST_MakePoint(${input.lng}, ${input.lat})::geography, ` +
    `${input.radiusMeters}` +
    `)`
  );
}

export interface WithinGeofenceInput {
  pointTable: string;
  geofenceTable: string;
  geofenceId: string;
  pointColumn?: string;
  areaColumn?: string;
}

/** Returns the SQL fragment for a `ST_Contains(geofence.area, point.location)` filter. */
export function buildWithinGeofenceQuery(input: WithinGeofenceInput): string {
  const pCol = input.pointColumn ?? "location";
  const aCol = input.areaColumn ?? "area";
  return (
    `SELECT p.* FROM "${input.pointTable}" p, "${input.geofenceTable}" g ` +
    `WHERE g.id = '${input.geofenceId}' ` +
    `AND ST_Contains(g."${aCol}", p."${pCol}")`
  );
}

// ────────────────────────────────────────────────────────────────────
// Internal
// ────────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
