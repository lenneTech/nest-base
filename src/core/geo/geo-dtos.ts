import { z } from "zod";

/**
 * Geo DTOs.
 *
 * Zod schemas the geo controllers consume. The controllers
 * themselves are project-side wiring (`src/modules/.../...`); this
 * file ships the validation surface so any project that turns the
 * geo feature on can re-use the same shape.
 */

const NonEmptyString = z.string().min(1);

/** ISO 3166-1 alpha-2 (DE, AT, US, ...). Two upper-case letters. */
const CountryCode = z
  .string()
  .regex(/^[A-Z]{2}$/, "country must be a 2-letter ISO 3166-1 alpha-2 code");

const Latitude = z.coerce.number().min(-90).max(90);
const Longitude = z.coerce.number().min(-180).max(180);

const LngLatPair = z.tuple([Longitude, Latitude]);

export const CreateAddressSchema = z.object({
  street: NonEmptyString,
  zip: NonEmptyString,
  city: NonEmptyString,
  country: CountryCode,
  state: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateAddressSchema = CreateAddressSchema.partial();

const ClosedRing = z
  .array(LngLatPair)
  .min(4, "polygon must have at least 4 points (3 unique + closing)")
  .refine(
    (pts) => {
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      return first[0] === last[0] && first[1] === last[1];
    },
    { message: "polygon must be closed (first point equals last point)" },
  );

export const CreateGeofenceSchema = z.object({
  name: NonEmptyString,
  description: z.string().optional(),
  category: z.string().optional(),
  polygon: ClosedRing,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const GeocodeQuerySchema = z.object({
  q: NonEmptyString,
});

export const ReverseGeocodeQuerySchema = z.object({
  lat: Latitude,
  lng: Longitude,
});

const MAX_PLACES_NEARBY_RADIUS_METERS = 100_000; // 100 km

export const PlacesNearbySchema = z.object({
  lat: Latitude,
  lng: Longitude,
  radiusMeters: z.coerce
    .number()
    .positive("radiusMeters must be > 0")
    .max(
      MAX_PLACES_NEARBY_RADIUS_METERS,
      `radiusMeters must be ≤ ${MAX_PLACES_NEARBY_RADIUS_METERS} (100 km)`,
    ),
});

export type CreateAddressInput = z.infer<typeof CreateAddressSchema>;
export type UpdateAddressInput = z.infer<typeof UpdateAddressSchema>;
export type CreateGeofenceInput = z.infer<typeof CreateGeofenceSchema>;
export type GeocodeQueryInput = z.infer<typeof GeocodeQuerySchema>;
export type ReverseGeocodeQueryInput = z.infer<typeof ReverseGeocodeQuerySchema>;
export type PlacesNearbyInput = z.infer<typeof PlacesNearbySchema>;
