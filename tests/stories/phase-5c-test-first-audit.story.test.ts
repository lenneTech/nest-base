import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · Phase 5c Test-First audit (PLAN.md §32 Phase 5c).
 *
 * Phase 5c's Test-First entry promises five story files cover the
 * load-bearing geo surfaces — Geocoding-Provider-Switch,
 * GeoJSON-Output-Mapping, findNearby/withinGeofence-Queries,
 * GeocodingCache-TTL, Address-PII-Encryption.
 */
describe("Story · Phase 5c Test-First audit", () => {
  const REQUIRED: Array<{ surface: string; file: string; describeFragment: string }> = [
    {
      surface: "Geocoding-Provider-Switch (Mapbox/Nominatim/Google/Local)",
      file: "tests/stories/geocoding-providers.story.test.ts",
      describeFragment: "GeocodingProvider",
    },
    {
      surface: "GeoJSON-Output-Mapping (Stage 3a)",
      file: "tests/stories/geojson-output-mapper.story.test.ts",
      describeFragment: "GeoJSON output mapper",
    },
    {
      surface: "findNearby / withinGeofence on GIST indexes",
      file: "tests/stories/geo-service.story.test.ts",
      describeFragment: "GeoService",
    },
    {
      surface: "GeocodingCache TTL + cleanup cron",
      file: "tests/stories/geocoding-cache-cleanup.story.test.ts",
      describeFragment: "GeocodingCache cleanup",
    },
    {
      surface: "Address-PII-Encryption roundtrip (street, zip)",
      file: "tests/stories/address-pii-encryption.story.test.ts",
      describeFragment: "Address PII encryption",
    },
  ];

  for (const entry of REQUIRED) {
    it(`covers "${entry.surface}" via ${entry.file}`, () => {
      const full = resolve(ROOT, entry.file);
      expect(existsSync(full), `${entry.file} must exist`).toBe(true);
      const content = readFileSync(full, "utf8");
      expect(content).toMatch(
        new RegExp(`describe\\([\\s\\S]*?${escapeRegex(entry.describeFragment)}`),
      );
    });
  }

  it("all five required stories are present (no count drift)", () => {
    expect(REQUIRED).toHaveLength(5);
  });
});

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
