/**
 * Boot-time runner: merge the Zod-named-schema registry and the
 * RFC 7807 problem-details components into the OpenAPI document
 * produced by `SwaggerModule.createDocument(...)`.
 *
 * `@nestjs/swagger`'s `createDocument` runs on every controller and
 * gathers `@ApiBody` / `@ApiResponse` / `@ApiQuery` / `@ApiParam`
 * metadata into a complete OpenAPI 3.0 document. The Zod decorators
 * push inline `SchemaObject`s, which works for routes that don't need
 * a named component. For routes that opt into a named component via
 * `registerZodSchema(name, schema)`, we have to splice
 * `components.schemas` AFTER `createDocument` runs because
 * `@nestjs/swagger` doesn't expose a registration hook for raw
 * components.
 *
 * This runner is the only consumer of `zodSchemaRegistryComponents()`
 * and `buildProblemDetailsOpenApiComponents()` outside of tests; the
 * `bootstrap()` function calls it once after `createDocument`. The
 * implementation is pure aside from the in-place mutation it
 * performs on the document — keeping the API surface narrow makes
 * the test much simpler (one in/out function).
 */

import { zodSchemaRegistryComponents } from "./zod-to-openapi.js";
import { buildProblemDetailsOpenApiComponents } from "../errors/openapi-problem-schemas.js";
import { CORE_ERROR_CODES } from "../errors/error-code.js";

/**
 * Minimal OpenAPI document shape we mutate. The full type from
 * `@nestjs/swagger` (`OpenAPIObject`) is structurally compatible —
 * we accept that as input via the loose typing below.
 */
export interface OpenApiDocument {
  components?: {
    schemas?: Record<string, unknown>;
    responses?: Record<string, unknown>;
  };
}

export interface ApplyZodSchemaRegistryOptions {
  /**
   * Project-specific `APP_*` error codes to add to the problem-details
   * schema's `code` enum. Empty by default — projects that have
   * their own error codes pass them in from `bootstrap()`.
   */
  appErrorCodes?: string[];
}

/**
 * Mutate the given OpenAPI document in place to add:
 *   1. Every Zod schema registered via `registerZodSchema(name, ...)`
 *      into `components.schemas`.
 *   2. The RFC 7807 `ProblemDetails` schema and `ProblemDetailsResponse`
 *      reusable response, so 4xx/5xx responses can `$ref` them.
 *
 * Returns the same document for fluent chaining. Existing entries in
 * `components.schemas` and `components.responses` are preserved —
 * `@nestjs/swagger` may have populated them from `@ApiExtraModels`
 * already; we only add, never overwrite.
 */
export function applyZodSchemaRegistry<T extends OpenApiDocument>(
  document: T,
  options: ApplyZodSchemaRegistryOptions = {},
): T {
  // The cast through `OpenApiDocument` is intentional: `@nestjs/swagger`
  // ships `OpenAPIObject` with stricter component typings than we need
  // here. We mutate the shape in a way that's structurally compatible
  // with both, so a single in-place cast is safer than rewriting the
  // OpenAPI types.
  const doc = document as OpenApiDocument;
  doc.components ??= {};
  const components = doc.components;
  components.schemas ??= {};
  components.responses ??= {};
  const schemas = components.schemas;
  const responses = components.responses;

  // 1. Zod-registered named schemas.
  const zodComponents = zodSchemaRegistryComponents();
  for (const [name, schema] of Object.entries(zodComponents.schemas)) {
    if (!(name in schemas)) {
      schemas[name] = schema;
    }
  }

  // 2. Problem-details. The builder is pure; we feed it the core
  // codes (always present) plus any project-specific codes the caller
  // passed in.
  const problemDetails = buildProblemDetailsOpenApiComponents({
    coreCodes: Object.values(CORE_ERROR_CODES),
    appCodes: options.appErrorCodes ?? [],
  });
  if (!("ProblemDetails" in schemas)) {
    schemas.ProblemDetails = problemDetails.components.schemas.ProblemDetails;
  }
  if (!("ProblemDetailsResponse" in responses)) {
    responses.ProblemDetailsResponse = problemDetails.components.responses.ProblemDetailsResponse;
  }

  return document;
}
