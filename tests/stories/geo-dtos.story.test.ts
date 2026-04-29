import { describe, expect, it } from "vitest";

import {
  CreateAddressSchema,
  CreateGeofenceSchema,
  GeocodeQuerySchema,
  PlacesNearbySchema,
  ReverseGeocodeQuerySchema,
  UpdateAddressSchema,
} from "../../src/core/geo/geo-dtos.js";

/**
 * Story · Geo DTOs (PLAN.md §15 + §32 Phase 5c).
 *
 * Zod schemas the geo controllers consume. The controllers
 * themselves are project-side wiring (`src/modules/...`) — this
 * slice ships the validation surface so any project's controller
 * can re-use the same shape.
 */
describe("Story · Geo DTOs", () => {
  describe("CreateAddressSchema", () => {
    it("accepts a minimal valid address", () => {
      const out = CreateAddressSchema.parse({
        street: "Hauptstraße 1",
        zip: "10115",
        city: "Berlin",
        country: "DE",
      });
      expect(out.street).toBe("Hauptstraße 1");
    });

    it("requires country as ISO 3166-1 alpha-2 (2 chars)", () => {
      expect(() =>
        CreateAddressSchema.parse({ street: "x", zip: "1", city: "x", country: "GERMANY" }),
      ).toThrow();
    });

    it("rejects empty required fields", () => {
      expect(() =>
        CreateAddressSchema.parse({ street: "", zip: "1", city: "x", country: "DE" }),
      ).toThrow();
    });

    it("accepts optional state + metadata", () => {
      const out = CreateAddressSchema.parse({
        street: "x",
        zip: "1",
        city: "x",
        country: "DE",
        state: "Berlin",
        metadata: { source: "manual-entry" },
      });
      expect(out.state).toBe("Berlin");
      expect(out.metadata).toEqual({ source: "manual-entry" });
    });
  });

  describe("UpdateAddressSchema", () => {
    it("makes every field optional (PATCH semantics)", () => {
      const out = UpdateAddressSchema.parse({ city: "Hamburg" });
      expect(out.city).toBe("Hamburg");
    });

    it("still validates supplied fields", () => {
      expect(() => UpdateAddressSchema.parse({ country: "DEU" })).toThrow();
    });
  });

  describe("CreateGeofenceSchema", () => {
    it("accepts a polygon as an array of [lng, lat] pairs", () => {
      const out = CreateGeofenceSchema.parse({
        name: "Berlin-Mitte",
        polygon: [
          [13.39, 52.51],
          [13.42, 52.51],
          [13.42, 52.53],
          [13.39, 52.53],
          [13.39, 52.51],
        ],
      });
      expect(out.polygon.length).toBe(5);
    });

    it("requires the polygon to close (first point == last point)", () => {
      expect(() =>
        CreateGeofenceSchema.parse({
          name: "broken",
          polygon: [
            [13.39, 52.51],
            [13.42, 52.51],
            [13.42, 52.53],
          ],
        }),
      ).toThrow(/closed/i);
    });

    it("requires at least 4 points (3 + closing)", () => {
      expect(() =>
        CreateGeofenceSchema.parse({
          name: "too-short",
          polygon: [
            [1, 1],
            [2, 2],
            [1, 1],
          ],
        }),
      ).toThrow();
    });
  });

  describe("GeocodeQuerySchema", () => {
    it("accepts a non-empty query", () => {
      expect(GeocodeQuerySchema.parse({ q: "Berlin" }).q).toBe("Berlin");
    });

    it("rejects an empty query", () => {
      expect(() => GeocodeQuerySchema.parse({ q: "" })).toThrow();
    });
  });

  describe("ReverseGeocodeQuerySchema", () => {
    it("accepts numeric lat / lng", () => {
      expect(ReverseGeocodeQuerySchema.parse({ lat: 52.52, lng: 13.405 })).toEqual({
        lat: 52.52,
        lng: 13.405,
      });
    });

    it("coerces stringified numbers (URL-query-friendly)", () => {
      const out = ReverseGeocodeQuerySchema.parse({ lat: "52.52", lng: "13.405" });
      expect(typeof out.lat).toBe("number");
      expect(out.lat).toBe(52.52);
    });

    it("rejects out-of-range lat / lng", () => {
      expect(() => ReverseGeocodeQuerySchema.parse({ lat: 100, lng: 0 })).toThrow();
      expect(() => ReverseGeocodeQuerySchema.parse({ lat: 0, lng: 200 })).toThrow();
    });
  });

  describe("PlacesNearbySchema", () => {
    it("takes lat / lng / radius", () => {
      const out = PlacesNearbySchema.parse({ lat: 52.52, lng: 13.405, radiusMeters: 1000 });
      expect(out.radiusMeters).toBe(1000);
    });

    it("rejects negative or zero radius", () => {
      expect(() => PlacesNearbySchema.parse({ lat: 0, lng: 0, radiusMeters: 0 })).toThrow();
      expect(() => PlacesNearbySchema.parse({ lat: 0, lng: 0, radiusMeters: -1 })).toThrow();
    });

    it('caps radius at 100 km (defense against accidental "search the planet")', () => {
      expect(() => PlacesNearbySchema.parse({ lat: 0, lng: 0, radiusMeters: 200_000 })).toThrow();
    });
  });
});
