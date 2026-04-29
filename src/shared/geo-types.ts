/**
 * Shared geo types (PLAN.md §32 Phase 5c).
 *
 * GeoJSON (RFC 7946) types the SDK + frontend pin against. Coordinate
 * order is GeoJSON-canonical: `[longitude, latitude]` (the inverse of
 * what humans usually say out loud, but the standard). PostGIS uses
 * the same axis order.
 */

export type Position = [number, number] | [number, number, number];

export interface Point {
  type: "Point";
  coordinates: Position;
}

export interface LineString {
  type: "LineString";
  coordinates: Position[];
}

export interface Polygon {
  type: "Polygon";
  /** Outer ring + zero-or-more inner rings (holes). Each ring is closed. */
  coordinates: Position[][];
}

export interface MultiPoint {
  type: "MultiPoint";
  coordinates: Position[];
}

export interface MultiLineString {
  type: "MultiLineString";
  coordinates: Position[][];
}

export interface MultiPolygon {
  type: "MultiPolygon";
  coordinates: Position[][][];
}

export type Geometry = Point | LineString | Polygon | MultiPoint | MultiLineString | MultiPolygon;

export interface Feature<P extends Record<string, unknown> = Record<string, unknown>> {
  type: "Feature";
  geometry: Geometry | null;
  properties: P;
  id?: string | number;
}

export interface FeatureCollection<P extends Record<string, unknown> = Record<string, unknown>> {
  type: "FeatureCollection";
  features: Feature<P>[];
}

// ────────────────────────────────────────────────────────────────────
// Type guards (no `unknown`-cast at the call site)
// ────────────────────────────────────────────────────────────────────

export function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown; coordinates?: unknown };
  return v.type === "Point" && Array.isArray(v.coordinates) && v.coordinates.length >= 2;
}

export function isPolygon(value: unknown): value is Polygon {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown; coordinates?: unknown };
  return v.type === "Polygon" && Array.isArray(v.coordinates);
}

export function isFeatureCollection(value: unknown): value is FeatureCollection {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown; features?: unknown };
  return v.type === "FeatureCollection" && Array.isArray(v.features);
}
