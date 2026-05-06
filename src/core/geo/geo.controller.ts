import { BadRequestException, Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";

import { Can } from "../permissions/can.guard.js";
import { GeocodeQuerySchema, PlacesNearbySchema, ReverseGeocodeQuerySchema } from "./geo-dtos.js";
import { GeoService, buildFindNearbyQuery } from "./geo-service.js";
import type { GeocodingResult } from "./geocoding-providers.js";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function requireTenantHeader(tenantHeader: string | undefined): string {
  const tenantId = tenantHeader?.trim() ?? "";
  if (tenantId.length === 0) {
    throw new BadRequestException("x-tenant-id header is required");
  }
  if (!UUID_PATTERN.test(tenantId)) {
    throw new BadRequestException("x-tenant-id header must be a valid UUID");
  }
  return tenantId;
}

/**
 * `/geo/*` and `/places/nearby` HTTP surface.
 *
 * - `GET /geo/geocode?query=…`
 * - `GET /geo/reverse-geocode?lat=…&lng=…`
 * - `POST /places/nearby` — body: `{ lat, lng, radius, table }`
 *
 * Address + Geofence CRUD live on dedicated controllers in their
 * own slices (the data-side wiring needs Prisma adapters).
 */
@Controller()
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Can("read", "Geo")
  @Get("geo/geocode")
  async geocode(@Query() query: Record<string, string>): Promise<GeocodingResult | null> {
    const parsed = GeocodeQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.geo.geocode(parsed.data.q);
  }

  @Can("read", "Geo")
  @Get("geo/reverse-geocode")
  async reverseGeocode(@Query() query: Record<string, string>): Promise<GeocodingResult | null> {
    const parsed = ReverseGeocodeQuerySchema.safeParse({
      lat: Number(query.lat),
      lng: Number(query.lng),
    });
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.geo.reverseGeocode(parsed.data.lat, parsed.data.lng);
  }

  @Can("read", "Geo")
  @Post("places/nearby")
  async placesNearby(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
    @Body() body: unknown,
  ): Promise<{ sql: string }> {
    // Iter-205 reviewer-G5 closure: require the operator's tenant on
    // every nearby query so the emitted SQL is tenant-bound at the
    // helper layer, defense-in-depth alongside the new RLS policy on
    // `addresses` (iter-204 migration).
    const tenantId = requireTenantHeader(tenantHeader);
    const parsed = PlacesNearbySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    // Surface the SQL builder output so callers see the query that
    // would be issued. The actual execution against a generic
    // /places/nearby table happens in domain modules — they pass
    // their own table to `buildFindNearbyQuery()`.
    const sql = buildFindNearbyQuery({
      table: "addresses",
      tenantId,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      radiusMeters: parsed.data.radiusMeters,
    });
    return { sql };
  }
}
