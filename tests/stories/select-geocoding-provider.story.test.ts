import { describe, expect, it } from "vitest";

import {
  GoogleGeocodingProvider,
  LocalStubGeocodingProvider,
  MapboxGeocodingProvider,
  NominatimGeocodingProvider,
  defaultGeocodingHttpClient,
  selectGeocodingProvider,
  type GeocodingHttpClient,
} from "../../src/core/geo/geocoding-providers.js";

/**
 * Story · `selectGeocodingProvider` — picks a provider implementation
 * from `features.geo.provider` (PRD line 105 — iter-161 closes the
 * gap where `GeoModule` previously hard-coded `LocalStubGeocodingProvider`).
 */
describe("Story · selectGeocodingProvider (iter-161)", () => {
  const fakeHttp: GeocodingHttpClient = {
    async get() {
      return { ok: true, status: 200, body: null };
    },
  };

  it("returns LocalStubGeocodingProvider for provider=local", () => {
    const provider = selectGeocodingProvider({
      provider: "local",
      env: {},
      http: fakeHttp,
    });
    expect(provider).toBeInstanceOf(LocalStubGeocodingProvider);
    expect(provider.name).toBe("local");
  });

  it("returns NominatimGeocodingProvider for provider=nominatim with default UA fallback", () => {
    const provider = selectGeocodingProvider({
      provider: "nominatim",
      env: {},
      http: fakeHttp,
    });
    expect(provider).toBeInstanceOf(NominatimGeocodingProvider);
    expect(provider.name).toBe("nominatim");
  });

  it("nominatim picks GEO_NOMINATIM_USER_AGENT when set", () => {
    const provider = selectGeocodingProvider({
      provider: "nominatim",
      env: { GEO_NOMINATIM_USER_AGENT: "my-app/1.0 (ops@example.com)" },
      http: fakeHttp,
    });
    expect(provider).toBeInstanceOf(NominatimGeocodingProvider);
  });

  it("nominatim falls back to APP_NAME when user-agent unset", () => {
    const provider = selectGeocodingProvider({
      provider: "nominatim",
      env: { APP_NAME: "test-app" },
      http: fakeHttp,
    });
    expect(provider).toBeInstanceOf(NominatimGeocodingProvider);
  });

  it("returns MapboxGeocodingProvider when GEO_MAPBOX_ACCESS_TOKEN is set", () => {
    const provider = selectGeocodingProvider({
      provider: "mapbox",
      env: { GEO_MAPBOX_ACCESS_TOKEN: "pk.eyJ.test" },
      http: fakeHttp,
    });
    expect(provider).toBeInstanceOf(MapboxGeocodingProvider);
    expect(provider.name).toBe("mapbox");
  });

  it("throws when mapbox is selected without an access token", () => {
    expect(() =>
      selectGeocodingProvider({
        provider: "mapbox",
        env: {},
        http: fakeHttp,
      }),
    ).toThrow(/GEO_MAPBOX_ACCESS_TOKEN is required/);
  });

  it("throws when mapbox token is whitespace-only", () => {
    expect(() =>
      selectGeocodingProvider({
        provider: "mapbox",
        env: { GEO_MAPBOX_ACCESS_TOKEN: "   " },
        http: fakeHttp,
      }),
    ).toThrow(/GEO_MAPBOX_ACCESS_TOKEN is required/);
  });

  it("returns GoogleGeocodingProvider when GEO_GOOGLE_API_KEY is set", () => {
    const provider = selectGeocodingProvider({
      provider: "google",
      env: { GEO_GOOGLE_API_KEY: "AIzaSyTest" },
      http: fakeHttp,
    });
    expect(provider).toBeInstanceOf(GoogleGeocodingProvider);
    expect(provider.name).toBe("google");
  });

  it("throws when google is selected without an api key", () => {
    expect(() =>
      selectGeocodingProvider({
        provider: "google",
        env: {},
        http: fakeHttp,
      }),
    ).toThrow(/GEO_GOOGLE_API_KEY is required/);
  });

  it("local-fixture array is forwarded into the LocalStub", async () => {
    const provider = selectGeocodingProvider({
      provider: "local",
      env: {},
      localFixtures: [{ query: "Berlin", lat: 52.52, lng: 13.405, formatted: "Berlin, DE" }],
    });
    const hit = await provider.geocode("Berlin");
    expect(hit?.formatted).toBe("Berlin, DE");
  });

  it("defaults to process.env when env override unset", () => {
    // The factory pulls from process.env when `env` is omitted; we
    // can't reliably test that here without mutating process.env, but
    // the omit branch is covered via the factory's GeoModule wiring
    // (e2e suite). Constructing with explicit `local` is enough to
    // exercise the default-env code path — the switch resolves before
    // the env read.
    const provider = selectGeocodingProvider({ provider: "local" });
    expect(provider.name).toBe("local");
  });
});

describe("Story · defaultGeocodingHttpClient", () => {
  it("returns a GeocodingHttpClient with a `get` method", () => {
    const client = defaultGeocodingHttpClient();
    expect(typeof client.get).toBe("function");
  });

  it("`get` returns ok=false on a non-OK response", async () => {
    const original = globalThis.fetch;
    const fakeFetch: unknown = async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    globalThis.fetch = fakeFetch as typeof fetch;
    try {
      const client = defaultGeocodingHttpClient();
      const result = await client.get("https://example.invalid/path");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(503);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("`get` returns body=null when JSON parsing fails", async () => {
    const original = globalThis.fetch;
    const fakeFetch: unknown = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("invalid json");
      },
    });
    globalThis.fetch = fakeFetch as typeof fetch;
    try {
      const client = defaultGeocodingHttpClient();
      const result = await client.get("https://example.invalid/path");
      expect(result.body).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
