import { describe, expect, it } from "vitest";

import {
  isFeatureCollection,
  isPoint,
  isPolygon,
  type Feature,
  type FeatureCollection,
  type Point,
  type Polygon,
} from "../../src/shared/geo-types.js";

/**
 * Story · Shared geo types (PLAN.md §32 Phase 5c).
 *
 * `src/shared/` ships types the SDK + frontend pin against. Geo
 * types follow GeoJSON (RFC 7946); we expose them through small
 * type-guards so non-TS consumers (or runtime payloads) can probe
 * the shape.
 */
describe("Story · Shared geo types", () => {
  describe("Point", () => {
    it("is the GeoJSON Point shape", () => {
      const p: Point = { type: "Point", coordinates: [13.405, 52.52] };
      expect(p.type).toBe("Point");
      expect(p.coordinates[0]).toBe(13.405);
    });

    it("isPoint() narrows on shape", () => {
      const candidate: unknown = { type: "Point", coordinates: [0, 0] };
      expect(isPoint(candidate)).toBe(true);
    });

    it("isPoint() rejects polygons + null + foreign types", () => {
      expect(isPoint(null)).toBe(false);
      expect(isPoint({ type: "Polygon", coordinates: [] })).toBe(false);
      expect(isPoint({ type: "Point" })).toBe(false);
      expect(isPoint({ type: "Point", coordinates: "invalid" })).toBe(false);
    });
  });

  describe("Polygon", () => {
    it("is the GeoJSON Polygon shape (rings of [lng, lat] pairs)", () => {
      const p: Polygon = {
        type: "Polygon",
        coordinates: [
          [
            [13.39, 52.51],
            [13.42, 52.51],
            [13.42, 52.53],
            [13.39, 52.53],
            [13.39, 52.51],
          ],
        ],
      };
      expect(p.coordinates[0]).toHaveLength(5);
    });

    it("isPolygon() narrows", () => {
      const p: unknown = {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      };
      expect(isPolygon(p)).toBe(true);
    });

    it("isPolygon() rejects bare points + non-array coordinates", () => {
      expect(isPolygon({ type: "Point", coordinates: [0, 0] })).toBe(false);
      expect(isPolygon({ type: "Polygon", coordinates: "x" })).toBe(false);
    });
  });

  describe("FeatureCollection", () => {
    it("is the GeoJSON FeatureCollection shape", () => {
      const fc: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: "a-1" },
          } satisfies Feature,
        ],
      };
      expect(fc.features).toHaveLength(1);
    });

    it("isFeatureCollection() narrows", () => {
      const fc: unknown = { type: "FeatureCollection", features: [] };
      expect(isFeatureCollection(fc)).toBe(true);
    });

    it("isFeatureCollection() rejects bare points + missing features", () => {
      expect(isFeatureCollection({ type: "Point", coordinates: [0, 0] })).toBe(false);
      expect(isFeatureCollection({ type: "FeatureCollection" })).toBe(false);
    });
  });
});
