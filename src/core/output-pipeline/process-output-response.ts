import type { Ability } from "../permissions/casl-ability.js";
import { OutputPipeline } from "./output-pipeline.js";
import { removeSecrets } from "./remove-secrets.js";
import { applySafetyNet, type SafetyNetMode } from "./safety-net.js";
import { mapRecordToGeoJson } from "../geo/geojson-output-mapper.js";

const GEOMETRY_COLUMNS = ["location", "area"];

export interface ProcessOutputResponseOptions {
  ability?: Ability;
  subject?: string;
  safetyNetMode?: SafetyNetMode;
}

/**
 * Shared output-pipeline entry used by the global interceptor and tests.
 * Runs Stage 2 when `ability` + `subject` are set; always runs Stages 3–4.
 */
export function processOutputResponse(
  value: unknown,
  options: ProcessOutputResponseOptions = {},
): unknown {
  if (value === null || value === undefined) return value;

  if (options.ability && options.subject) {
    return new OutputPipeline({
      ability: options.ability,
      safetyNetMode: options.safetyNetMode ?? "mask",
    }).run(value, { subject: options.subject });
  }

  const geo = mapGeoJsonRecursively(value);
  const stripped = removeSecrets(geo);
  return applySafetyNet(stripped, { mode: options.safetyNetMode ?? "mask" });
}

function mapGeoJsonRecursively(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => mapGeoJsonRecursively(item));
  }
  if (value !== null && typeof value === "object") {
    try {
      const mapped = mapRecordToGeoJson(value as Record<string, unknown>, GEOMETRY_COLUMNS);
      if (Array.isArray(mapped)) return mapped;
      const out: Record<string, unknown> = { ...(mapped as Record<string, unknown>) };
      for (const [k, v] of Object.entries(out)) {
        if (GEOMETRY_COLUMNS.includes(k)) continue;
        out[k] = mapGeoJsonRecursively(v);
      }
      return out;
    } catch {
      return value;
    }
  }
  return value;
}
