import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";

import { GeocodeQuerySchema, PlacesNearbySchema, ReverseGeocodeQuerySchema } from "./geo-dtos.js";
import { GeoService, buildFindNearbyQuery } from "./geo-service.js";
import type { GeocodingResult } from "./geocoding-providers.js";

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

  @Get("geo/geocode")
  async geocode(@Query() query: Record<string, string>): Promise<GeocodingResult | null> {
    const parsed = GeocodeQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.geo.geocode(parsed.data.q);
  }

  @Get("geo/reverse-geocode")
  async reverseGeocode(@Query() query: Record<string, string>): Promise<GeocodingResult | null> {
    const parsed = ReverseGeocodeQuerySchema.safeParse({
      lat: Number(query.lat),
      lng: Number(query.lng),
    });
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.geo.reverseGeocode(parsed.data.lat, parsed.data.lng);
  }

  @Post("places/nearby")
  async placesNearby(@Body() body: unknown): Promise<{ sql: string }> {
    const parsed = PlacesNearbySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    // Surface the SQL builder output so callers see the query that
    // would be issued. The actual execution against a generic
    // /places/nearby table happens in domain modules — they pass
    // their own table + tenantId to `buildFindNearbyQuery()`.
    const sql = buildFindNearbyQuery({
      table: "addresses",
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      radiusMeters: parsed.data.radiusMeters,
    });
    return { sql };
  }
}
