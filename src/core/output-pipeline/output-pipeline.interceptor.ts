import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { type Observable, map } from "rxjs";

import { mapRecordToGeoJson } from "../geo/geojson-output-mapper.js";
import { removeSecrets } from "./remove-secrets.js";
import { applySafetyNet } from "./safety-net.js";

/**
 * Global Output-Pipeline interceptor.
 *
 * Runs Stages 3a (GeoJSON conversion), 3 (strip secrets) and 4
 * (safety-net) on every controller response. Stages 1 (record-level
 * permission filter) and 2 (field allowlist) require an `Ability`
 * resolvable from the request — that activates once auth is wired
 * and a `request.user` carries one.
 *
 * Stage 3a converts Postgres geometry columns (`ST_AsGeoJSON()`
 * output) into the RFC 7946 envelope frontends expect. Default
 * column list: `location`, `area`. Domain modules can extend this
 * via a future `@GeoColumn()` registry.
 */
@Injectable()
export class OutputPipelineInterceptor implements NestInterceptor {
  /** Conventional geometry column names the mapper rewrites. */
  private static readonly GEOMETRY_COLUMNS = ["location", "area"];

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value) => this.process(value)));
  }

  private process(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    // Stage 3a — convert geometry columns to GeoJSON shapes
    const geo = this.mapGeoJsonRecursively(value);
    // Stage 3 — strip known-secret keys recursively
    const stripped = removeSecrets(geo);
    // Stage 4 — safety net (mask mode in the global path so a missed
    // secret-shaped field surfaces as `[redacted]` rather than crashing
    // the response; controllers that need the strict 'throw' behaviour
    // can wrap themselves in the full `OutputPipeline` class).
    return applySafetyNet(stripped, { mode: "mask" });
  }

  private mapGeoJsonRecursively(value: unknown): unknown {
    const cols = OutputPipelineInterceptor.GEOMETRY_COLUMNS;
    if (Array.isArray(value)) {
      return value.map((item) => this.mapGeoJsonRecursively(item));
    }
    if (value !== null && typeof value === "object") {
      try {
        const mapped = mapRecordToGeoJson(value as Record<string, unknown>, cols);
        if (Array.isArray(mapped)) return mapped;
        // Recurse into nested objects so `{ user: { …, location } }` is
        // covered too. The mapper itself only touches top-level keys.
        const out: Record<string, unknown> = { ...(mapped as Record<string, unknown>) };
        for (const [k, v] of Object.entries(out)) {
          if (cols.includes(k)) continue;
          out[k] = this.mapGeoJsonRecursively(v);
        }
        return out;
      } catch {
        // Malformed geometry → fall through, leave value untouched. The
        // safety-net stage will catch obvious leaks regardless.
        return value;
      }
    }
    return value;
  }
}
