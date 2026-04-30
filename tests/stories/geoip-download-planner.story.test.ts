import { describe, expect, it } from "vitest";

import {
  GEOIP_DEFAULT_DB_PATH,
  GeoIpLicenseKeyMissingError,
  GeoIpUnsupportedProviderError,
  planGeoIpDownload,
} from "../../src/core/geoip/download-planner.js";

/**
 * Story · GeoIp Download Planner
 *
 * Pure planner: takes provider + license-key + an explicit "now"
 * (so URL templates that embed `YYYY-MM` stay deterministic in tests)
 * and returns the download spec. No fs, no fetch.
 *
 * Two providers ship:
 *   - dbip-lite (default) — no key, monthly, CC-BY-4.0
 *   - maxmind  (opt-in)   — license-key required (Schrems-II)
 */
describe("Story · GeoIp Download Planner", () => {
  describe("dbip-lite", () => {
    it("baut die monatliche dbip-city-lite-URL aus der `now`-Zeit", () => {
      const plan = planGeoIpDownload({
        provider: "dbip-lite",
        now: new Date("2026-04-15T00:00:00Z"),
      });
      expect(plan.provider).toBe("dbip-lite");
      expect(plan.url).toBe(
        "https://download.db-ip.com/free/dbip-city-lite-2026-04.mmdb.gz",
      );
      expect(plan.archiveFormat).toBe("gz");
      expect(plan.savePath).toBe(GEOIP_DEFAULT_DB_PATH);
      expect(plan.cadence).toBe("monthly");
      expect(plan.licenseLabel).toBe("CC-BY-4.0 (db-ip.com)");
      // Monthly snapshots: kein Pflicht-License-Key.
      expect(plan.requiresLicenseKey).toBe(false);
    });

    it("padded den Monat zweistellig (01..09 mit führender Null)", () => {
      const plan = planGeoIpDownload({
        provider: "dbip-lite",
        now: new Date("2026-01-03T00:00:00Z"),
      });
      expect(plan.url).toContain("2026-01.mmdb.gz");
    });

    it("nimmt einen explizit gesetzten dbPath", () => {
      const plan = planGeoIpDownload({
        provider: "dbip-lite",
        now: new Date("2026-04-15T00:00:00Z"),
        dbPath: "/var/lib/geoip/city.mmdb",
      });
      expect(plan.savePath).toBe("/var/lib/geoip/city.mmdb");
    });

    it("ignoriert einen optional gesetzten licenseKey (dbip-lite braucht ihn nicht)", () => {
      const plan = planGeoIpDownload({
        provider: "dbip-lite",
        now: new Date("2026-04-15T00:00:00Z"),
        licenseKey: "ignored-on-dbip",
      });
      expect(plan.url).not.toContain("ignored-on-dbip");
    });
  });

  describe("maxmind", () => {
    it("baut die GeoLite2-City-Download-URL inkl. License-Key", () => {
      const plan = planGeoIpDownload({
        provider: "maxmind",
        now: new Date("2026-04-15T00:00:00Z"),
        licenseKey: "abc123XYZ",
      });
      expect(plan.provider).toBe("maxmind");
      expect(plan.url).toBe(
        "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=abc123XYZ&suffix=tar.gz",
      );
      expect(plan.archiveFormat).toBe("tar.gz");
      expect(plan.cadence).toBe("weekly");
      expect(plan.licenseLabel).toContain("MaxMind");
      expect(plan.requiresLicenseKey).toBe(true);
    });

    it("wirft GeoIpLicenseKeyMissingError ohne licenseKey", () => {
      expect(() =>
        planGeoIpDownload({
          provider: "maxmind",
          now: new Date("2026-04-15T00:00:00Z"),
        }),
      ).toThrow(GeoIpLicenseKeyMissingError);
    });

    it("wirft GeoIpLicenseKeyMissingError bei leerem licenseKey", () => {
      expect(() =>
        planGeoIpDownload({
          provider: "maxmind",
          now: new Date("2026-04-15T00:00:00Z"),
          licenseKey: "   ",
        }),
      ).toThrow(GeoIpLicenseKeyMissingError);
    });

    it("URL-encodet Sonderzeichen im License-Key", () => {
      const plan = planGeoIpDownload({
        provider: "maxmind",
        now: new Date("2026-04-15T00:00:00Z"),
        licenseKey: "a/b+c=d",
      });
      expect(plan.url).toContain("license_key=a%2Fb%2Bc%3Dd");
    });
  });

  describe("error paths", () => {
    it("wirft GeoIpUnsupportedProviderError für unbekannte Provider", () => {
      expect(() =>
        planGeoIpDownload({
          // @ts-expect-error — explizit invalid für Runtime-Branch
          provider: "ipinfo",
          now: new Date("2026-04-15T00:00:00Z"),
        }),
      ).toThrow(GeoIpUnsupportedProviderError);
    });
  });
});
