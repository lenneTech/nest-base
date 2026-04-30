import { describe, expect, it } from "vitest";

import { FEATURE_CATALOG, isFeatureActive } from "../../src/core/dx/feature-catalog.js";
import { FeaturesSchema, loadFeatures } from "../../src/core/features/features.js";

/**
 * Story · GeoIp Feature-Flag
 *
 * `FeaturesSchema.geoIp` is the third "geo*" subsection (alongside
 * `geo` for geocoding and PostGIS). It defaults to off, picks
 * `dbip-lite` as the no-key provider, and exposes
 * `licenseKey` + `dbPath` for opt-in MaxMind tuning.
 *
 * The feature catalog must list it so `/dev/features` can render
 * the toggle, and `loadFeatures()` must respond to the
 * `FEATURE_GEO_IP_*` ENV-Var family.
 */
describe("Story · GeoIp Feature-Flag", () => {
  it("defaults: enabled=false, provider=dbip-lite, dbPath=./data/geoip/city.mmdb", () => {
    const features = FeaturesSchema.parse({});
    expect(features.geoIp.enabled).toBe(false);
    expect(features.geoIp.provider).toBe("dbip-lite");
    expect(features.geoIp.licenseKey).toBeUndefined();
    expect(features.geoIp.dbPath).toBe("./data/geoip/city.mmdb");
  });

  it("FEATURE_GEO_IP_ENABLED=true flips the toggle on", () => {
    const features = loadFeatures({ FEATURE_GEO_IP_ENABLED: "true" });
    expect(features.geoIp.enabled).toBe(true);
  });

  it("FEATURE_GEO_IP_PROVIDER=maxmind switches the provider", () => {
    const features = loadFeatures({
      FEATURE_GEO_IP_ENABLED: "true",
      FEATURE_GEO_IP_PROVIDER: "maxmind",
      FEATURE_GEO_IP_LICENSE_KEY: "abc123",
    });
    expect(features.geoIp.provider).toBe("maxmind");
    expect(features.geoIp.licenseKey).toBe("abc123");
  });

  it("rejects unknown providers", () => {
    expect(() => loadFeatures({ FEATURE_GEO_IP_PROVIDER: "ipinfo" })).toThrow();
  });

  it("FEATURE_GEO_IP_DB_PATH overrides the .mmdb location", () => {
    const features = loadFeatures({ FEATURE_GEO_IP_DB_PATH: "/var/lib/geoip/city.mmdb" });
    expect(features.geoIp.dbPath).toBe("/var/lib/geoip/city.mmdb");
  });

  it("FEATURE_CATALOG enthält den neuen geoIp-Eintrag", () => {
    const meta = FEATURE_CATALOG.find((f) => f.key === "geoIp");
    expect(meta).toBeDefined();
    expect(meta?.envKey).toBe("FEATURE_GEO_IP_ENABLED");
    expect(meta?.category).toBe("data");
    expect(meta?.exposes.length).toBeGreaterThan(0);
  });

  it("isFeatureActive reagiert auf FEATURE_GEO_IP_ENABLED", () => {
    const off = loadFeatures({});
    expect(isFeatureActive(off, "geoIp")).toBe(false);
    const on = loadFeatures({ FEATURE_GEO_IP_ENABLED: "true" });
    expect(isFeatureActive(on, "geoIp")).toBe(true);
  });
});
