/**
 * Zod → OpenAPI 3.0 schema bridge.
 *
 * Pure planner. Converts a Zod schema into the OpenAPI 3.0
 * `SchemaObject` JSON form via Zod 4's built-in `z.toJSONSchema()`
 * processor with `target: "openapi-3.0"`.
 *
 * Why a thin wrapper instead of inlining `z.toJSONSchema(...)` at every
 * call site? Three reasons that pay rent:
 *
 *   1. **Determinism**: `z.toJSONSchema()` may emit the JSON-Schema
 *      `$schema` keyword, which is illegal in OpenAPI 3.0
 *      `SchemaObject`. We strip it once here so callers don't have to
 *      remember.
 *   2. **Single seam**: if we ever swap the conversion library, every
 *      call funnels through this function — the rest of the bridge
 *      doesn't move.
 *   3. **Named-schema registry**: keeping the bridge in one module
 *      lets `@ApiZodResponse({ schema, name })` opt into a `$ref`
 *      instead of inlining the same shape across 30 endpoints, which
 *      keeps the OpenAPI document compact and lets the kubb-generated
 *      SDK reuse types.
 *
 * The decorators in `zod-api-decorators.ts` and the boot-time runner
 * in `zod-openapi-bridge.ts` are the only consumers in core.
 */

import { z, type ZodType } from "zod";

/**
 * The OpenAPI 3.0 `SchemaObject` we actually emit. Keeps the surface
 * narrow — full OpenAPI is a 200kB type, we only care about the
 * fields `z.toJSONSchema(..., { target: "openapi-3.0" })` produces.
 */
export interface OpenApiSchemaObject {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
  format?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  items?: OpenApiSchemaObject | { $ref: string };
  properties?: Record<string, OpenApiSchemaObject | { $ref: string }>;
  required?: string[];
  additionalProperties?: boolean | OpenApiSchemaObject | { $ref: string };
  enum?: Array<string | number | boolean | null>;
  const?: string | number | boolean | null;
  default?: unknown;
  description?: string;
  title?: string;
  nullable?: boolean;
  oneOf?: Array<OpenApiSchemaObject | { $ref: string }>;
  anyOf?: Array<OpenApiSchemaObject | { $ref: string }>;
  allOf?: Array<OpenApiSchemaObject | { $ref: string }>;
  $ref?: string;
}

/**
 * Convert a Zod schema to an OpenAPI 3.0 SchemaObject fragment.
 *
 * Strips JSON-Schema-only keywords (`$schema`) that OpenAPI 3.0
 * rejects. The output is plain JSON — safe to pass to
 * `@ApiBody({ schema })`, `@ApiResponse({ schema })`, or to embed in
 * `components.schemas`.
 *
 * Throws if Zod fails to convert (e.g. a `z.never()` or a function
 * type appearing in a public surface) — fail-loud at boot beats
 * shipping an empty `{}` schema that the SDK generator silently turns
 * into `unknown`.
 */
export function zodSchemaToOpenApi(schema: ZodType): OpenApiSchemaObject {
  // `target: "openapi-3.0"` produces a fragment compatible with the
  // `SchemaObject` definition in OpenAPI 3.0.x — uses `nullable: true`
  // (not the draft-2020 `["string", "null"]` array form), which the
  // current Scalar UI + kubb stack expect.
  const out = z.toJSONSchema(schema, { target: "openapi-3.0" }) as Record<string, unknown> & {
    $schema?: unknown;
  };
  // Defensive — strip the JSON-Schema metadata keyword if a future
  // Zod release re-introduces it.
  if ("$schema" in out) {
    delete out.$schema;
  }
  return out as OpenApiSchemaObject;
}

/**
 * Internal registry of named Zod schemas. Keys are the schema names
 * exposed under `components.schemas` in the OpenAPI document; values
 * are the already-converted OpenAPI fragments (we cache the
 * conversion result, not the Zod schema, so re-running the bridge is
 * O(n) over the registry size, not over the schema graph).
 */
const REGISTRY = new Map<string, OpenApiSchemaObject>();

/**
 * Register a Zod schema under a stable name. The schema becomes
 * available via `components.schemas[name]` once `applyZodSchemaRegistry`
 * runs at boot. Decorators that pass `{ name: "Foo" }` use this
 * registry so the OpenAPI document stays compact ($ref instead of
 * inlining the same 30-property object across every route that
 * returns it).
 *
 * Re-registering the same name with a structurally identical schema
 * is a no-op (test environments load modules twice). Re-registering
 * with a different schema throws — silently overwriting would let
 * one module clobber another's contract.
 */
export function registerZodSchema(name: string, schema: ZodType): void {
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `registerZodSchema: name "${name}" must match /^[A-Z][A-Za-z0-9_]*$/ ` +
        `(used as components.schemas key — keep it PascalCase).`,
    );
  }
  const fragment = zodSchemaToOpenApi(schema);
  const existing = REGISTRY.get(name);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(fragment)) {
      throw new Error(
        `registerZodSchema: name "${name}" is already registered with a structurally ` +
          `different schema. Two modules cannot register the same OpenAPI component name ` +
          `with diverging shapes.`,
      );
    }
    return;
  }
  REGISTRY.set(name, fragment);
}

/**
 * Build the `components.schemas` block for the registered Zod schemas.
 *
 * Sorted alphabetically by name so the OpenAPI document is
 * byte-deterministic across re-runs (CI snapshot diffs stay clean).
 * Returns a fresh object each call — the result can be mutated by
 * the caller without affecting the registry.
 */
export function zodSchemaRegistryComponents(): {
  schemas: Record<string, OpenApiSchemaObject>;
} {
  const sortedNames = [...REGISTRY.keys()].sort();
  const schemas: Record<string, OpenApiSchemaObject> = {};
  for (const name of sortedNames) {
    schemas[name] = REGISTRY.get(name)!;
  }
  return { schemas };
}

/**
 * Reset the registry. Test-only — production code never clears the
 * registry. Tests that exercise `registerZodSchema` need a clean slate
 * because the registry is a process-wide singleton.
 */
export function resetZodSchemaRegistryForTests(): void {
  REGISTRY.clear();
}
