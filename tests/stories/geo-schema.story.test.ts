import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { FeaturesSchema } from "../../src/core/features/features.js";
import { concatenateSchema } from "../../src/core/setup/schema-concat.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · Geo schema.
 *
 * Three feature-gated models — Address, Geofence, GeocodingCache —
 * live in `prisma/features/geo.prisma` and are concatenated into the
 * generated schema only when `features.geo.enabled === true`.
 */
describe("Story · Geo schema", () => {
  function readGeoSchema(): string {
    const p = resolve(ROOT, "prisma/features/geo.prisma");
    expect(existsSync(p), "prisma/features/geo.prisma must exist").toBe(true);
    return readFileSync(p, "utf8");
  }

  describe("Address model", () => {
    const schema = readGeoSchema;

    it("declares an Address model with PostGIS geometry location", () => {
      const src = schema();
      expect(src).toMatch(/model\s+Address\s*\{/);
      expect(src).toMatch(/location\s+Unsupported\("geometry\(Point,\s*4326\)"\)\?/);
    });

    it("carries the Stripe-style address fields (street/zip/city/country)", () => {
      const src = schema();
      const block = /model\s+Address\s*\{[\s\S]*?\}/.exec(src)?.[0] ?? "";
      expect(block).toMatch(/street\s+String/);
      expect(block).toMatch(/zip\s+String/);
      expect(block).toMatch(/city\s+String/);
      expect(block).toMatch(/country\s+String/);
    });

    it("records geocoding provenance (formattedAddress, geocodingProvider, geocodedAt)", () => {
      const src = schema();
      const block = /model\s+Address\s*\{[\s\S]*?\}/.exec(src)?.[0] ?? "";
      expect(block).toMatch(/formattedAddress/);
      expect(block).toMatch(/geocodingProvider/);
      expect(block).toMatch(/geocodedAt/);
    });

    it("scopes by tenant", () => {
      const src = schema();
      const block = /model\s+Address\s*\{[\s\S]*?\}/.exec(src)?.[0] ?? "";
      expect(block).toMatch(/tenantId\s+String\?/);
      expect(block).toMatch(/@@index\(\[tenantId\]\)/);
    });
  });

  describe("Geofence model", () => {
    it("declares a Geofence with a Polygon geometry", () => {
      const src = readGeoSchema();
      expect(src).toMatch(/model\s+Geofence\s*\{/);
      expect(src).toMatch(/area\s+Unsupported\("geometry\(Polygon,\s*4326\)"\)/);
    });

    it("carries name + category for human-readable filtering", () => {
      const src = readGeoSchema();
      const block = /model\s+Geofence\s*\{[\s\S]*?\}/.exec(src)?.[0] ?? "";
      expect(block).toMatch(/name\s+String/);
      expect(block).toMatch(/category\s+String\?/);
    });
  });

  describe("GeocodingCache model", () => {
    it("declares a GeocodingCache for upstream-API result memoisation", () => {
      const src = readGeoSchema();
      expect(src).toMatch(/model\s+GeocodingCache\s*\{/);
    });

    it("keys cache entries by (provider, queryHash) with an expiresAt", () => {
      const src = readGeoSchema();
      const block = /model\s+GeocodingCache\s*\{[\s\S]*?\}/.exec(src)?.[0] ?? "";
      expect(block).toMatch(/provider\s+String/);
      expect(block).toMatch(/queryHash\s+String/);
      expect(block).toMatch(/expiresAt\s+DateTime/);
      expect(block).toMatch(/@@unique\(\[provider,\s*queryHash\]\)/);
    });
  });

  describe("schema-concat integration", () => {
    it("schema-concat includes geo.prisma when features.geo.enabled is true", () => {
      const out = concatenateSchema({
        coreSchema: "model User { id String @id }",
        featureSchemas: { geo: readGeoSchema() },
        features: FeaturesSchema.parse({ geo: { enabled: true, provider: "nominatim" } }),
      });
      expect(out.includedFeatures).toContain("geo");
      expect(out.schema).toContain("model Address");
    });

    it("schema-concat skips geo.prisma when the feature is off", () => {
      const out = concatenateSchema({
        coreSchema: "model User { id String @id }",
        featureSchemas: {},
        features: FeaturesSchema.parse({ geo: { enabled: false, provider: "nominatim" } }),
      });
      expect(out.includedFeatures).not.toContain("geo");
    });
  });
});
