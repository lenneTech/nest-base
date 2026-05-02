/**
 * `@ApiZod*` decorators — Zod-native wrappers around `@nestjs/swagger`.
 *
 * Why these exist: `@nestjs/swagger`'s built-in `@ApiBody({ type: X })`
 * pulls metadata from `class-validator` / TypeScript class types,
 * which Zod schemas don't have (Zod is value-level, not class-level).
 * Without a bridge, a Zod-validated route reaches the OpenAPI
 * document with no body or response schema, which the kubb-generated
 * SDK turns into `body?: never` / `200: unknown`.
 *
 * These decorators are zero-cost wrappers: they call
 * `zodSchemaToOpenApi(schema)` once at decoration time and forward
 * the resulting OpenAPI fragment to `@ApiBody`, `@ApiResponse`,
 * `@ApiQuery`, or `@ApiParam`. The fragment lands in the
 * `@nestjs/swagger` metadata pipeline like any other schema, so
 * `SwaggerModule.createDocument(...)` picks it up without further
 * wiring.
 *
 * The pure conversion lives in `zod-to-openapi.ts`. This module is
 * the thin runner that adapts it to the `@nestjs/swagger` API.
 */

import {
  ApiBody,
  type ApiBodyOptions,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiParam,
  type ApiParamOptions,
  ApiQuery,
  type ApiQueryOptions,
  ApiResponse,
  type ApiResponseOptions,
} from "@nestjs/swagger";
import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface.js";
import type { ZodType, ZodObject } from "zod";

import { type OpenApiSchemaObject, zodSchemaToOpenApi } from "./zod-to-openapi.js";

// All `@nestjs/swagger` `Api*` decorators return at minimum a
// `MethodDecorator`. Some (Param/Query/etc.) widen to `MethodDecorator &
// ClassDecorator`; we use the narrowest common return type so consumers
// can stack on a method without `as` casts.
type ApiMethodDecorator = MethodDecorator;

interface ApiZodResponseInput {
  schema: ZodType;
  description?: string;
}

/**
 * `@nestjs/swagger` exposes `SchemaObject` as the precise type of the
 * `schema` field across the `Api*` options interfaces (each option is a
 * union; the schema-host variant uses `SchemaObject`). Our own
 * `OpenApiSchemaObject` is structurally compatible — the cast is a
 * type-only seam and incurs no runtime cost.
 */
function castSchema(fragment: OpenApiSchemaObject): SchemaObject {
  return fragment as unknown as SchemaObject;
}

/**
 * Type-guard: is this Zod schema a `ZodObject`? `@ApiZodQuery` only
 * makes sense for objects (each top-level property becomes a separate
 * query parameter); arrays / primitives aren't representable.
 */
function isZodObject(schema: ZodType): schema is ZodObject {
  // Zod 4 stores the runtime type tag under `_def.type` on instances
  // returned from `z.object(...)`. We avoid `instanceof ZodObject`
  // because Zod's class hierarchy is internal/private and changes
  // between minor versions.
  const def = (schema as unknown as { _def?: { type?: string } })._def;
  return def?.type === "object";
}

/**
 * Annotate a route handler's request body with a Zod schema. Mirrors
 * `@ApiBody({ type: X })` but takes a Zod schema; the schema becomes
 * a non-empty `requestBody.content['application/json'].schema` in
 * the OpenAPI document.
 */
export function ApiZodBody(schema: ZodType, description?: string): ApiMethodDecorator {
  const fragment = zodSchemaToOpenApi(schema);
  const options: ApiBodyOptions = {
    schema: castSchema(fragment),
    required: true,
    ...(description ? { description } : {}),
  };
  return ApiBody(options);
}

/**
 * Annotate a route handler's response body with a Zod schema and
 * an HTTP status. The status defaults to 200; pass an explicit one
 * if the route returns 201/204/etc.
 */
export function ApiZodResponse(status: number, input: ApiZodResponseInput): ApiMethodDecorator {
  const fragment = zodSchemaToOpenApi(input.schema);
  const options: ApiResponseOptions = {
    status,
    schema: castSchema(fragment),
    description: input.description ?? "",
  };
  return ApiResponse(options);
}

/** Convenience for `200 OK` — most GET handlers. */
export function ApiZodOkResponse(input: ApiZodResponseInput): ApiMethodDecorator {
  const fragment = zodSchemaToOpenApi(input.schema);
  return ApiOkResponse({
    schema: castSchema(fragment),
    description: input.description ?? "",
  });
}

/** Convenience for `201 Created` — most POST handlers. */
export function ApiZodCreatedResponse(input: ApiZodResponseInput): ApiMethodDecorator {
  const fragment = zodSchemaToOpenApi(input.schema);
  return ApiCreatedResponse({
    schema: castSchema(fragment),
    description: input.description ?? "",
  });
}

/**
 * Convenience for `204 No Content` — Delete handlers usually. The
 * schema is omitted because 204 carries no body, but the description
 * is still surfaced.
 */
export function ApiZodNoContentResponse(description?: string): ApiMethodDecorator {
  return ApiNoContentResponse({ description: description ?? "" });
}

/**
 * Annotate a route's query string with a Zod object schema. Each
 * top-level property of the object becomes a separate `parameters`
 * entry in OpenAPI (this matches what kubb expects to type the
 * `query: { ... }` slot of the generated SDK).
 *
 * If the input isn't an object, throws — a primitive schema for
 * `@Query` would be ambiguous (no name).
 */
export function ApiZodQuery(schema: ZodType): ApiMethodDecorator {
  if (!isZodObject(schema)) {
    throw new Error(
      "ApiZodQuery: expected a `z.object({...})` schema. " +
        "Each top-level property becomes a separate query parameter.",
    );
  }
  const fragment = zodSchemaToOpenApi(schema);
  if (fragment.type !== "object" || !fragment.properties) {
    throw new Error("ApiZodQuery: converted schema is missing properties.");
  }
  const requiredSet = new Set(fragment.required ?? []);
  const decorators: ApiMethodDecorator[] = [];
  // Iterate sorted so the OpenAPI doc is deterministic regardless of
  // insertion order in the source Zod schema (Zod preserves insertion
  // order, but downstream consumers shouldn't rely on it).
  const propNames = Object.keys(fragment.properties).sort();
  for (const name of propNames) {
    const propSchema = fragment.properties[name] as OpenApiSchemaObject;
    // A field with a `default` is "required" in JSON-Schema's
    // data-out sense (the parsed object will always have the field),
    // but for query strings the CLIENT may omit it — Zod fills the
    // default. So we mark the parameter optional whenever a default
    // is present.
    const hasDefault = propSchema && typeof propSchema === "object" && "default" in propSchema;
    const required = requiredSet.has(name) && !hasDefault;
    const options: ApiQueryOptions = {
      name,
      required,
      schema: castSchema(propSchema),
    };
    decorators.push(ApiQuery(options));
  }
  return composeMethodDecorators(decorators);
}

/**
 * Annotate a route's path parameter with a Zod schema. The parameter
 * is always `required: true` (path parameters have no notion of
 * optional in HTTP).
 */
export function ApiZodParam(name: string, schema: ZodType): ApiMethodDecorator {
  const fragment = zodSchemaToOpenApi(schema);
  const options: ApiParamOptions = {
    name,
    required: true,
    schema: castSchema(fragment),
  };
  return ApiParam(options);
}

/**
 * Compose multiple method decorators into one. NestJS' `applyDecorators`
 * helper exists in `@nestjs/common` but importing it just for this
 * one-line wrapper would pull in framework metadata helpers we don't
 * need. The local implementation is six lines and matches the
 * standard pattern.
 */
function composeMethodDecorators(decorators: ApiMethodDecorator[]): ApiMethodDecorator {
  return (target, propertyKey, descriptor) => {
    for (const decorator of decorators) {
      decorator(target, propertyKey, descriptor);
    }
  };
}
