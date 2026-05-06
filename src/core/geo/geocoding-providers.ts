/**
 * GeocodingProvider adapters.
 *
 * Four adapters, one normalised result shape. Each takes an
 * injectable HTTP client + its own credentials. The HTTP layer is
 * abstracted through `GeocodingHttpClient` so tests stay
 * network-free; the production wiring uses any fetch-shaped client.
 *
 * Why an interface (not a discriminated union): different providers
 * have wildly different response shapes; rather than collapsing
 * them into a tagged-union, each adapter normalises into the same
 * `GeocodingResult` so callers stay provider-agnostic.
 */

export interface GeocodingHttpResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

export interface GeocodingHttpClient {
  get(url: string, headers?: Record<string, string>): Promise<GeocodingHttpResponse>;
}

export interface GeocodingResult {
  lat: number;
  lng: number;
  formatted: string;
  /** Raw provider payload — kept for cache + debugging. */
  providerMetadata?: unknown;
}

export interface GeocodingProvider {
  name: string;
  geocode(query: string): Promise<GeocodingResult | null>;
  reverseGeocode(lat: number, lng: number): Promise<GeocodingResult | null>;
}

// ────────────────────────────────────────────────────────────────────
// Nominatim (OpenStreetMap) — free, ToS requires User-Agent.
// ────────────────────────────────────────────────────────────────────

export interface NominatimOptions {
  http: GeocodingHttpClient;
  userAgent: string;
}

export class NominatimGeocodingProvider implements GeocodingProvider {
  readonly name = "nominatim";
  constructor(private readonly opts: NominatimOptions) {}

  async geocode(query: string): Promise<GeocodingResult | null> {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=1`;
    const res = await this.opts.http.get(url, { "User-Agent": this.opts.userAgent });
    return this.normaliseFirst(res.body);
  }

  async reverseGeocode(lat: number, lng: number): Promise<GeocodingResult | null> {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2`;
    const res = await this.opts.http.get(url, { "User-Agent": this.opts.userAgent });
    return this.normaliseFirst(res.body);
  }

  private normaliseFirst(body: unknown): GeocodingResult | null {
    if (Array.isArray(body)) {
      const first = body[0] as { lat?: string; lon?: string; display_name?: string } | undefined;
      if (!first || first.lat === undefined || first.lon === undefined) return null;
      return {
        lat: Number(first.lat),
        lng: Number(first.lon),
        formatted: first.display_name ?? "",
        providerMetadata: first,
      };
    }
    if (body && typeof body === "object") {
      const r = body as { lat?: string; lon?: string; display_name?: string };
      if (r.lat !== undefined && r.lon !== undefined) {
        return {
          lat: Number(r.lat),
          lng: Number(r.lon),
          formatted: r.display_name ?? "",
          providerMetadata: r,
        };
      }
    }
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// Mapbox — paid; uses access_token.
// ────────────────────────────────────────────────────────────────────

export interface MapboxOptions {
  http: GeocodingHttpClient;
  accessToken: string;
}

export class MapboxGeocodingProvider implements GeocodingProvider {
  readonly name = "mapbox";
  constructor(private readonly opts: MapboxOptions) {}

  async geocode(query: string): Promise<GeocodingResult | null> {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${this.opts.accessToken}&limit=1`;
    const res = await this.opts.http.get(url);
    return this.normaliseFirst(res.body);
  }

  async reverseGeocode(lat: number, lng: number): Promise<GeocodingResult | null> {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${this.opts.accessToken}&limit=1`;
    const res = await this.opts.http.get(url);
    return this.normaliseFirst(res.body);
  }

  private normaliseFirst(body: unknown): GeocodingResult | null {
    const obj = body as
      | { features?: Array<{ center?: [number, number]; place_name?: string }> }
      | undefined;
    const first = obj?.features?.[0];
    if (!first?.center) return null;
    const [lng, lat] = first.center;
    return {
      lat,
      lng,
      formatted: first.place_name ?? "",
      providerMetadata: first,
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// Google Maps — paid; uses key=.
// ────────────────────────────────────────────────────────────────────

export interface GoogleOptions {
  http: GeocodingHttpClient;
  apiKey: string;
}

export class GoogleGeocodingProvider implements GeocodingProvider {
  readonly name = "google";
  constructor(private readonly opts: GoogleOptions) {}

  async geocode(query: string): Promise<GeocodingResult | null> {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${this.opts.apiKey}`;
    const res = await this.opts.http.get(url);
    return this.normaliseFirst(res.body);
  }

  async reverseGeocode(lat: number, lng: number): Promise<GeocodingResult | null> {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${this.opts.apiKey}`;
    const res = await this.opts.http.get(url);
    return this.normaliseFirst(res.body);
  }

  private normaliseFirst(body: unknown): GeocodingResult | null {
    const obj = body as
      | {
          status?: string;
          results?: Array<{
            geometry?: { location?: { lat?: number; lng?: number } };
            formatted_address?: string;
          }>;
        }
      | undefined;
    if (!obj || obj.status !== "OK") return null;
    const first = obj.results?.[0];
    const loc = first?.geometry?.location;
    if (!loc || loc.lat === undefined || loc.lng === undefined) return null;
    return {
      lat: loc.lat,
      lng: loc.lng,
      formatted: first?.formatted_address ?? "",
      providerMetadata: first,
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// Local fake — deterministic, no HTTP. For tests + air-gapped dev.
// ────────────────────────────────────────────────────────────────────

export interface LocalStubFixture {
  query: string;
  lat: number;
  lng: number;
  formatted: string;
}

export interface LocalStubOptions {
  seedFixtures: LocalStubFixture[];
}

export class LocalStubGeocodingProvider implements GeocodingProvider {
  readonly name = "local";
  constructor(private readonly opts: LocalStubOptions) {}

  async geocode(query: string): Promise<GeocodingResult | null> {
    const hit = this.opts.seedFixtures.find((f) => f.query === query);
    if (!hit) return null;
    return { lat: hit.lat, lng: hit.lng, formatted: hit.formatted };
  }

  async reverseGeocode(lat: number, lng: number): Promise<GeocodingResult | null> {
    const hit = this.opts.seedFixtures.find((f) => f.lat === lat && f.lng === lng);
    if (!hit) return null;
    return { lat: hit.lat, lng: hit.lng, formatted: hit.formatted };
  }
}

// ────────────────────────────────────────────────────────────────────
// Provider selection helper (iter-161, closes PRD line 105)
// ────────────────────────────────────────────────────────────────────

/**
 * Default `fetch`-backed HTTP client. The `userAgent` keeps Nominatim
 * happy (their ToS requires identifying the caller). Tests inject
 * a fake — the helper is exported so projects that prefer their own
 * HTTP layer can swap it.
 */
export function defaultGeocodingHttpClient(): GeocodingHttpClient {
  return {
    async get(url, headers) {
      const response = await fetch(url, { method: "GET", headers });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { ok: response.ok, status: response.status, body };
    },
  };
}

export type GeocodingProviderName = "mapbox" | "google" | "nominatim" | "local";

export interface SelectGeocodingProviderInput {
  /** Reads `features.geo.provider` (Zod-validated upstream). */
  readonly provider: GeocodingProviderName;
  /** Source for credentials + user-agent. Defaults to `process.env`. */
  readonly env?: Record<string, string | undefined>;
  /** Optional HTTP-client override; defaults to `defaultGeocodingHttpClient()`. */
  readonly http?: GeocodingHttpClient;
  /** Local-stub fixtures when `provider === "local"`. */
  readonly localFixtures?: LocalStubFixture[];
}

/**
 * Returns the provider implementation that matches the project's
 * `features.geo.provider` setting (PRD line 105: "Geocoding (4
 * providers: mapbox / google / nominatim / local)"). Throws when a
 * remote provider is selected without its credential env-var set so
 * the operator sees the misconfiguration immediately.
 */
export function selectGeocodingProvider(input: SelectGeocodingProviderInput): GeocodingProvider {
  const env = input.env ?? process.env;
  const http = input.http ?? defaultGeocodingHttpClient();
  switch (input.provider) {
    case "local":
      return new LocalStubGeocodingProvider({ seedFixtures: input.localFixtures ?? [] });
    case "nominatim": {
      const userAgent =
        present(env["GEO_NOMINATIM_USER_AGENT"]) ??
        present(env["APP_NAME"]) ??
        "nest-base/0 (set GEO_NOMINATIM_USER_AGENT)";
      return new NominatimGeocodingProvider({ http, userAgent });
    }
    case "mapbox": {
      const accessToken = present(env["GEO_MAPBOX_ACCESS_TOKEN"]);
      if (accessToken === undefined) {
        throw new Error(
          "selectGeocodingProvider: GEO_MAPBOX_ACCESS_TOKEN is required when features.geo.provider=mapbox",
        );
      }
      return new MapboxGeocodingProvider({ http, accessToken });
    }
    case "google": {
      const apiKey = present(env["GEO_GOOGLE_API_KEY"]);
      if (apiKey === undefined) {
        throw new Error(
          "selectGeocodingProvider: GEO_GOOGLE_API_KEY is required when features.geo.provider=google",
        );
      }
      return new GoogleGeocodingProvider({ http, apiKey });
    }
  }
}

function present(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
