import { describe, expect, it } from "vitest";

import {
  GoogleGeocodingProvider,
  LocalStubGeocodingProvider,
  MapboxGeocodingProvider,
  NominatimGeocodingProvider,
  type GeocodingHttpClient,
  type GeocodingProvider,
  type GeocodingResult,
} from "../../src/core/geo/geocoding-providers.js";

/**
 * Story · GeocodingProvider adapters.
 *
 * Four adapters, one normalised result shape (`GeocodingResult`).
 * Each adapter takes an injectable HTTP client + its own credentials
 * and produces:
 *
 *   - `geocode(query)`            → `{ lat, lng, formatted, providerMetadata }`
 *   - `reverseGeocode(lat, lng)`  → same shape
 *
 * Tests stay HTTP-free by injecting a recorded fake; we assert the
 * request shape (URL, headers, params) the adapter emits + the
 * response normalisation it does.
 */
describe("Story · GeocodingProvider adapters", () => {
  function fakeHttp(
    responseBody: unknown,
  ): GeocodingHttpClient & { calls: Array<{ url: string; headers?: Record<string, string> }> } {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    return {
      calls,
      async get(url, headers) {
        calls.push({ url, headers });
        return { ok: true, status: 200, body: responseBody };
      },
    };
  }

  describe("NominatimGeocodingProvider", () => {
    it("hits the OpenStreetMap Nominatim endpoint", async () => {
      const http = fakeHttp([{ lat: "52.5200", lon: "13.4050", display_name: "Berlin, Germany" }]);
      const provider = new NominatimGeocodingProvider({ http, userAgent: "test/1.0" });
      await provider.geocode("Berlin");
      expect(http.calls[0]?.url).toMatch(/nominatim\.openstreetmap\.org\/search/);
      expect(http.calls[0]?.url).toContain("q=Berlin");
      expect(http.calls[0]?.url).toContain("format=jsonv2");
    });

    it("sets the required User-Agent (Nominatim ToS)", async () => {
      const http = fakeHttp([]);
      const provider = new NominatimGeocodingProvider({ http, userAgent: "my-app/1.0" });
      await provider.geocode("x");
      expect(http.calls[0]?.headers?.["User-Agent"]).toBe("my-app/1.0");
    });

    it("normalises the response into the standard shape", async () => {
      const http = fakeHttp([{ lat: "52.5200", lon: "13.4050", display_name: "Berlin, Germany" }]);
      const provider = new NominatimGeocodingProvider({ http, userAgent: "test/1.0" });
      const out = await provider.geocode("Berlin");
      expect(out).toMatchObject({
        lat: 52.52,
        lng: 13.405,
        formatted: "Berlin, Germany",
      } satisfies Partial<GeocodingResult>);
    });

    it("returns null when no result was returned", async () => {
      const http = fakeHttp([]);
      const provider = new NominatimGeocodingProvider({ http, userAgent: "test/1.0" });
      expect(await provider.geocode("nonsense-place-12345")).toBeNull();
    });
  });

  describe("MapboxGeocodingProvider", () => {
    it("hits the Mapbox geocoding endpoint with the access token", async () => {
      const http = fakeHttp({ features: [] });
      const provider = new MapboxGeocodingProvider({ http, accessToken: "pk.test" });
      await provider.geocode("Berlin");
      expect(http.calls[0]?.url).toMatch(/api\.mapbox\.com\/geocoding\/v5\/mapbox\.places/);
      expect(http.calls[0]?.url).toContain("access_token=pk.test");
    });

    it("normalises the Mapbox feature shape", async () => {
      const http = fakeHttp({
        features: [{ center: [13.405, 52.52], place_name: "Berlin, Deutschland" }],
      });
      const provider = new MapboxGeocodingProvider({ http, accessToken: "pk.test" });
      const out = await provider.geocode("Berlin");
      expect(out).toMatchObject({
        lat: 52.52,
        lng: 13.405,
        formatted: "Berlin, Deutschland",
      });
    });
  });

  describe("GoogleGeocodingProvider", () => {
    it("hits the Google geocoding endpoint with the API key", async () => {
      const http = fakeHttp({ status: "ZERO_RESULTS", results: [] });
      const provider = new GoogleGeocodingProvider({ http, apiKey: "AIza-test" });
      await provider.geocode("Berlin");
      expect(http.calls[0]?.url).toMatch(/maps\.googleapis\.com\/maps\/api\/geocode\/json/);
      expect(http.calls[0]?.url).toContain("key=AIza-test");
    });

    it("normalises the Google geometry.location response", async () => {
      const http = fakeHttp({
        status: "OK",
        results: [
          {
            geometry: { location: { lat: 52.52, lng: 13.405 } },
            formatted_address: "Berlin, Germany",
          },
        ],
      });
      const provider = new GoogleGeocodingProvider({ http, apiKey: "AIza-test" });
      const out = await provider.geocode("Berlin");
      expect(out).toMatchObject({ lat: 52.52, lng: 13.405, formatted: "Berlin, Germany" });
    });

    it("returns null on ZERO_RESULTS", async () => {
      const http = fakeHttp({ status: "ZERO_RESULTS", results: [] });
      const provider = new GoogleGeocodingProvider({ http, apiKey: "AIza-test" });
      expect(await provider.geocode("nonsense")).toBeNull();
    });
  });

  describe("LocalStubGeocodingProvider", () => {
    it("returns deterministic coordinates without any HTTP", async () => {
      const provider = new LocalStubGeocodingProvider({
        seedFixtures: [
          { query: "Berlin", lat: 52.52, lng: 13.405, formatted: "Berlin" },
          { query: "Paris", lat: 48.857, lng: 2.353, formatted: "Paris" },
        ],
      });
      expect(await provider.geocode("Berlin")).toMatchObject({ lat: 52.52, lng: 13.405 });
      expect(await provider.geocode("Paris")).toMatchObject({ lat: 48.857, lng: 2.353 });
    });

    it("returns null for an unseeded query (deterministic)", async () => {
      const provider = new LocalStubGeocodingProvider({ seedFixtures: [] });
      expect(await provider.geocode("Atlantis")).toBeNull();
    });

    it("reverse-geocodes by exact lat/lng match", async () => {
      const provider = new LocalStubGeocodingProvider({
        seedFixtures: [{ query: "Berlin", lat: 52.52, lng: 13.405, formatted: "Berlin" }],
      });
      expect(await provider.reverseGeocode(52.52, 13.405)).toMatchObject({ formatted: "Berlin" });
    });
  });

  describe("contract — every adapter implements GeocodingProvider", () => {
    function assertContract(provider: GeocodingProvider): void {
      expect(typeof provider.geocode).toBe("function");
      expect(typeof provider.reverseGeocode).toBe("function");
      expect(typeof provider.name).toBe("string");
    }

    it("Nominatim, Mapbox, Google, LocalStub all match the interface", () => {
      assertContract(new NominatimGeocodingProvider({ http: fakeHttp([]), userAgent: "x" }));
      assertContract(
        new MapboxGeocodingProvider({ http: fakeHttp({ features: [] }), accessToken: "t" }),
      );
      assertContract(
        new GoogleGeocodingProvider({ http: fakeHttp({ status: "OK", results: [] }), apiKey: "k" }),
      );
      assertContract(new LocalStubGeocodingProvider({ seedFixtures: [] }));
    });
  });
});
