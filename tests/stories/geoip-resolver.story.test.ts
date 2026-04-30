import { describe, expect, it } from "vitest";

import { mapMmdbCityRecord } from "../../src/core/geoip/resolver.js";

/**
 * Story · GeoIp Resolver (pure mapper)
 *
 * `mapMmdbCityRecord(raw)` is the pure function that converts a
 * MaxMind/dbip-lite city record (their JSON shape after .mmdb
 * decode) into our normalised `GeoIpLookupResult`. The runtime
 * `GeoIpService` wraps the `.mmdb` reader; this helper is the
 * unit-testable seam.
 *
 * Why pure: the GeoIpService can't load a `.mmdb` in CI without
 * a fixture file, but the mapping logic — which fields to pluck,
 * how to fall back when partial data is present — needs coverage.
 */
describe("Story · GeoIp Resolver Mapping", () => {
  it("mappt einen vollständigen MaxMind-City-Record", () => {
    const raw = {
      country: { iso_code: "US", names: { en: "United States" } },
      city: { names: { en: "Mountain View" } },
      subdivisions: [{ iso_code: "CA", names: { en: "California" } }],
      location: { latitude: 37.386, longitude: -122.0838, accuracy_radius: 1000 },
    };
    const result = mapMmdbCityRecord(raw);
    expect(result).toEqual({
      country: "United States",
      countryCode: "US",
      city: "Mountain View",
      region: "California",
      regionCode: "CA",
      latitude: 37.386,
      longitude: -122.0838,
      accuracyRadius: 1000,
    });
  });

  it("mappt einen reduzierten dbip-lite-Record (nur country)", () => {
    const raw = {
      country: { iso_code: "DE", names: { en: "Germany" } },
    };
    const result = mapMmdbCityRecord(raw);
    expect(result).toEqual({
      country: "Germany",
      countryCode: "DE",
    });
  });

  it("returnt null für ein leeres Objekt", () => {
    expect(mapMmdbCityRecord({})).toBeNull();
  });

  it("returnt null für null/undefined", () => {
    expect(mapMmdbCityRecord(null)).toBeNull();
    expect(mapMmdbCityRecord(undefined)).toBeNull();
  });

  it("ignoriert numerische Felder mit fehlenden Werten", () => {
    const raw = {
      country: { iso_code: "FR", names: { en: "France" } },
      location: { latitude: 48.8566 }, // longitude fehlt → kein Lat/Lng-Pair
    };
    const result = mapMmdbCityRecord(raw);
    expect(result?.country).toBe("France");
    // Kein vollständiges Lat/Lng-Pair → beide weglassen
    expect(result?.latitude).toBeUndefined();
    expect(result?.longitude).toBeUndefined();
  });

  it("nimmt city.names.en sowie das erste subdivision-Element", () => {
    const raw = {
      country: { iso_code: "GB", names: { en: "United Kingdom" } },
      city: { names: { en: "London" } },
      subdivisions: [
        { iso_code: "ENG", names: { en: "England" } },
        { iso_code: "LND", names: { en: "Greater London" } },
      ],
    };
    const result = mapMmdbCityRecord(raw);
    expect(result?.city).toBe("London");
    expect(result?.region).toBe("England");
    expect(result?.regionCode).toBe("ENG");
  });

  it("ist robust gegen fehlende names-Maps", () => {
    const raw = { country: { iso_code: "JP" } };
    const result = mapMmdbCityRecord(raw);
    expect(result).toEqual({ countryCode: "JP" });
  });
});
