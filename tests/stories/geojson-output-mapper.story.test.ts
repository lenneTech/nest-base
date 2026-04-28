import { describe, expect, it } from 'vitest';

import {
  mapGeometryToGeoJson,
  mapRecordToGeoJson,
} from '../../src/core/geo/geojson-output-mapper.js';

/**
 * Story · GeoJSON Output Mapper (PLAN.md §15 + §32 Phase 5c).
 *
 * Stage 3a of the Output-Pipeline: when a record carries a Postgres
 * geometry column, replace it with a GeoJSON-shaped object so the
 * REST response is RFC 7946-compliant. The mapper accepts the two
 * shapes Prisma + the @prisma/adapter-pg driver-adapter return:
 *
 *   1. `{ type: 'Point', coordinates: [lng, lat] }`         (already-GeoJSON)
 *   2. WKT hex / WKB Buffer  → fed through ST_AsGeoJSON before reaching us
 *
 * In practice the project's PrismaService runs ST_AsGeoJSON in its
 * SELECT clause, so the value already arrives shaped (1). The
 * mapper validates it + passes through, and rejects malformed input
 * loudly so a misconfigured query surfaces in dev rather than
 * shipping garbage to a frontend SDK.
 */
describe('Story · GeoJSON output mapper', () => {
  describe('mapGeometryToGeoJson()', () => {
    it('passes through a valid Point', () => {
      const out = mapGeometryToGeoJson({
        type: 'Point',
        coordinates: [13.405, 52.52],
      });
      expect(out).toEqual({ type: 'Point', coordinates: [13.405, 52.52] });
    });

    it('passes through a valid Polygon', () => {
      const polygon = {
        type: 'Polygon',
        coordinates: [
          [[13.39, 52.51], [13.42, 52.51], [13.42, 52.53], [13.39, 52.53], [13.39, 52.51]],
        ],
      };
      expect(mapGeometryToGeoJson(polygon)).toEqual(polygon);
    });

    it('passes through a FeatureCollection', () => {
      const fc = {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
        ],
      };
      expect(mapGeometryToGeoJson(fc)).toEqual(fc);
    });

    it('returns null for null/undefined (column was NULL in Postgres)', () => {
      expect(mapGeometryToGeoJson(null)).toBeNull();
      expect(mapGeometryToGeoJson(undefined)).toBeNull();
    });

    it('parses a JSON string emitted by ST_AsGeoJSON', () => {
      const out = mapGeometryToGeoJson('{"type":"Point","coordinates":[13.405,52.52]}');
      expect(out).toEqual({ type: 'Point', coordinates: [13.405, 52.52] });
    });

    it('throws on malformed input (bare string, wrong type)', () => {
      expect(() => mapGeometryToGeoJson('not-json')).toThrow();
      expect(() => mapGeometryToGeoJson({ type: 'NotAGeometry' })).toThrow();
    });
  });

  describe('mapRecordToGeoJson()', () => {
    it('replaces the named geometry column with a GeoJSON object', () => {
      const out = mapRecordToGeoJson(
        {
          id: 'a-1',
          street: 'Hauptstraße 1',
          location: { type: 'Point', coordinates: [13.405, 52.52] },
        },
        ['location'],
      );
      expect(out.location).toEqual({ type: 'Point', coordinates: [13.405, 52.52] });
      expect(out.id).toBe('a-1');
      expect(out.street).toBe('Hauptstraße 1');
    });

    it('handles multiple geometry columns in the same record', () => {
      const out = mapRecordToGeoJson(
        {
          id: 'g-1',
          area: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
          centroid: { type: 'Point', coordinates: [0.5, 0.5] },
        },
        ['area', 'centroid'],
      );
      expect(out.area).toMatchObject({ type: 'Polygon' });
      expect(out.centroid).toMatchObject({ type: 'Point' });
    });

    it('leaves non-geometry columns untouched', () => {
      const out = mapRecordToGeoJson(
        { id: 'a-1', street: 'x', location: { type: 'Point', coordinates: [0, 0] } },
        ['location'],
      );
      expect(out.street).toBe('x');
    });

    it('preserves null geometry columns as null', () => {
      const out = mapRecordToGeoJson(
        { id: 'a-1', location: null },
        ['location'],
      );
      expect(out.location).toBeNull();
    });

    it('walks an array of records', () => {
      const out = mapRecordToGeoJson(
        [
          { id: 'a-1', location: { type: 'Point', coordinates: [0, 0] } },
          { id: 'a-2', location: { type: 'Point', coordinates: [1, 1] } },
        ],
        ['location'],
      );
      expect(Array.isArray(out)).toBe(true);
      expect((out as unknown[])).toHaveLength(2);
    });
  });
});
