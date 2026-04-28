/**
 * GeoJSON output mapper (PLAN.md §15 + §32 Phase 5c, Stage 3a).
 *
 * The Output-Pipeline runs in 4 stages: permission filter, field
 * allowlist, strip secrets, safety net. Stage 3a is wedged in
 * between the field allowlist and the secret-strip — when a record
 * carries a Postgres geometry column, replace the column value with
 * a GeoJSON-shaped object so the REST response is RFC 7946-compliant.
 *
 * The PrismaService SELECTs `ST_AsGeoJSON(location)` so the value
 * already arrives as either:
 *   - an object: `{ type: 'Point', coordinates: [lng, lat] }`
 *   - a JSON string: `'{"type":"Point","coordinates":[13.4,52.5]}'`
 *
 * The mapper accepts both, validates the GeoJSON envelope, and
 * rejects everything else loudly so a misconfigured query surfaces
 * in dev rather than shipping garbage to a frontend SDK.
 */

const VALID_GEOMETRY_TYPES = new Set([
  'Point',
  'LineString',
  'Polygon',
  'MultiPoint',
  'MultiLineString',
  'MultiPolygon',
  'GeometryCollection',
  'Feature',
  'FeatureCollection',
]);

export type GeoJsonGeometry =
  | { type: 'Point'; coordinates: [number, number] | [number, number, number] }
  | { type: 'LineString'; coordinates: number[][] }
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPoint'; coordinates: number[][] }
  | { type: 'MultiLineString'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: 'GeometryCollection'; geometries: unknown[] }
  | { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }
  | { type: 'FeatureCollection'; features: unknown[] };

export class GeoJsonMalformedError extends Error {
  constructor(reason: string) {
    super(`geo: malformed GeoJSON (${reason})`);
    this.name = 'GeoJsonMalformedError';
  }
}

export function mapGeometryToGeoJson(value: unknown): GeoJsonGeometry | null {
  if (value === null || value === undefined) return null;

  let candidate: unknown = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch (err) {
      throw new GeoJsonMalformedError(`string is not JSON: ${(err as Error).message}`);
    }
  }

  if (!candidate || typeof candidate !== 'object') {
    throw new GeoJsonMalformedError('value is not an object');
  }
  const obj = candidate as { type?: unknown };
  if (typeof obj.type !== 'string' || !VALID_GEOMETRY_TYPES.has(obj.type)) {
    throw new GeoJsonMalformedError(`unknown type "${String(obj.type)}"`);
  }
  return candidate as GeoJsonGeometry;
}

export function mapRecordToGeoJson<T extends Record<string, unknown>>(
  record: T | T[],
  geometryColumns: string[],
): T | T[] {
  if (Array.isArray(record)) {
    return record.map((row) => mapRecordToGeoJson(row, geometryColumns) as T);
  }
  const out: Record<string, unknown> = { ...record };
  for (const col of geometryColumns) {
    if (col in out) {
      out[col] = mapGeometryToGeoJson(out[col]);
    }
  }
  return out as T;
}
