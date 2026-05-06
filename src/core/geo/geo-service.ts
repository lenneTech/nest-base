import { createHash } from "node:crypto";

import type { GeocodingProvider, GeocodingResult } from "./geocoding-providers.js";

/**
 * GeoService.
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
  /**
   * Tenant scope for the spatial query. Required — every callsite
   * must thread the operator's tenant through the SQL emission so
   * the result set is bounded to rows the caller is allowed to see.
   * Iter-205 reviewer-G5 closure: previously the helper emitted no
   * `tenant_id` predicate, which left the tenant boundary entirely
   * to RLS at runtime — defense-in-depth alongside RLS.
   */
  tenantId: string;
  lat: number;
  lng: number;
  /** Radius in metres. Must be > 0. */
  radiusMeters: number;
  /** Column holding the geometry; defaults to "location". */
  locationColumn?: string;
  /**
   * Tenant column on the target table; defaults to `"tenantId"`
   * (camelCase, matching the geo schema's `addresses`/`geofences`).
   * Domain modules with snake_case columns (`tenant_id`) override.
   */
  tenantColumn?: string;
}

const TENANT_UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Returns the SQL fragment for a `ST_DWithin` spatial-radius filter
 * scoped to a single tenant. The PostGIS axis order is (lng, lat);
 * the `::geography` cast makes the radius argument metres rather
 * than degrees. The tenantId is validated as a UUID at the helper
 * boundary so the inlined value cannot smuggle SQL.
 */
export function buildFindNearbyQuery(input: FindNearbyInput): string {
  if (input.radiusMeters <= 0) {
    throw new Error(`geo: findNearby radius must be > 0 (got ${input.radiusMeters})`);
  }
  if (!input.tenantId || !TENANT_UUID_PATTERN.test(input.tenantId)) {
    throw new Error(
      `geo: findNearby tenantId must be a valid UUID (got ${String(input.tenantId)})`,
    );
  }
  const col = input.locationColumn ?? "location";
  const tenantCol = input.tenantColumn ?? "tenantId";
  return (
    `SELECT * FROM "${input.table}" ` +
    `WHERE "${tenantCol}" = '${input.tenantId}' ` +
    `AND ST_DWithin(` +
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
  /**
   * Tenant scope for the spatial join. Required — every callsite
   * threads the operator's tenant through to the SQL emission. Iter-205
   * step-6 reviewer-flagged sibling closure: previously this helper
   * had neither a tenant predicate nor `geofenceId` UUID validation,
   * which left it as the unfixed twin of `buildFindNearbyQuery`.
   */
  tenantId: string;
  pointColumn?: string;
  areaColumn?: string;
  /**
   * Tenant column on both `pointTable` and `geofenceTable`; defaults
   * to `"tenantId"` matching the geo schema. Domain modules with
   * snake_case columns (`tenant_id`) override.
   */
  tenantColumn?: string;
}

/**
 * Returns the SQL fragment for a `ST_Contains(geofence.area, point.location)`
 * filter scoped to a single tenant on BOTH the point and geofence
 * tables. Both `tenantId` and `geofenceId` are validated as UUIDs at
 * the helper boundary so the inlined values cannot smuggle SQL.
 */
export function buildWithinGeofenceQuery(input: WithinGeofenceInput): string {
  if (!input.tenantId || !TENANT_UUID_PATTERN.test(input.tenantId)) {
    throw new Error(
      `geo: withinGeofence tenantId must be a valid UUID (got ${String(input.tenantId)})`,
    );
  }
  if (!input.geofenceId || !TENANT_UUID_PATTERN.test(input.geofenceId)) {
    throw new Error(
      `geo: withinGeofence geofenceId must be a valid UUID (got ${String(input.geofenceId)})`,
    );
  }
  const pCol = input.pointColumn ?? "location";
  const aCol = input.areaColumn ?? "area";
  const tenantCol = input.tenantColumn ?? "tenantId";
  return (
    `SELECT p.* FROM "${input.pointTable}" p, "${input.geofenceTable}" g ` +
    `WHERE g."${tenantCol}" = '${input.tenantId}' ` +
    `AND p."${tenantCol}" = '${input.tenantId}' ` +
    `AND g.id = '${input.geofenceId}' ` +
    `AND ST_Contains(g."${aCol}", p."${pCol}")`
  );
}

// ────────────────────────────────────────────────────────────────────
// Internal
// ────────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
