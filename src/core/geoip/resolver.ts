/**
 * GeoIp resolver — pure record mapper.
 *
 * MaxMind / dbip-lite emit the same `.mmdb` City record shape:
 *   { country: { iso_code, names: { en } },
 *     city: { names: { en } },
 *     subdivisions: [{ iso_code, names: { en } }],
 *     location: { latitude, longitude, accuracy_radius } }
 *
 * `mapMmdbCityRecord(raw)` plucks the fields we surface and falls
 * back gracefully on partial records (dbip-lite's free tier omits
 * the city for many small IP blocks). Returning a partial object —
 * or `null` if the record holds nothing usable — keeps callers from
 * branching on every nested field.
 */

export interface GeoIpLookupResult {
  country?: string;
  countryCode?: string;
  region?: string;
  regionCode?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  accuracyRadius?: number;
}

interface MmdbNamedRecord {
  iso_code?: string;
  names?: { en?: string } | undefined;
}

interface MmdbCityRecordShape {
  country?: MmdbNamedRecord;
  registered_country?: MmdbNamedRecord;
  city?: { names?: { en?: string } };
  subdivisions?: MmdbNamedRecord[];
  location?: {
    latitude?: number;
    longitude?: number;
    accuracy_radius?: number;
  };
}

export function mapMmdbCityRecord(raw: unknown): GeoIpLookupResult | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as MmdbCityRecordShape;

  const out: GeoIpLookupResult = {};

  // Prefer `country` over `registered_country` — the latter is the
  // ISP's billing country, the former is the geo-located one.
  const country = record.country ?? record.registered_country;
  if (country?.names?.en) out.country = country.names.en;
  if (country?.iso_code) out.countryCode = country.iso_code;

  const subdivision = record.subdivisions?.[0];
  if (subdivision?.names?.en) out.region = subdivision.names.en;
  if (subdivision?.iso_code) out.regionCode = subdivision.iso_code;

  if (record.city?.names?.en) out.city = record.city.names.en;

  // Lat/Lng only when both arrived — half a coordinate is worse
  // than none. accuracy_radius travels with location.
  const lat = record.location?.latitude;
  const lng = record.location?.longitude;
  if (typeof lat === "number" && typeof lng === "number") {
    out.latitude = lat;
    out.longitude = lng;
    if (typeof record.location?.accuracy_radius === "number") {
      out.accuracyRadius = record.location.accuracy_radius;
    }
  }

  return Object.keys(out).length === 0 ? null : out;
}
