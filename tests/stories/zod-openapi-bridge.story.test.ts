import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  registerZodSchema,
  resetZodSchemaRegistryForTests,
} from "../../src/core/openapi/zod-to-openapi.js";
import { applyZodSchemaRegistry } from "../../src/core/openapi/zod-openapi-bridge.js";

/**
 * Story · `applyZodSchemaRegistry` runner.
 *
 * Boot-time runner that mutates the OpenAPI document produced by
 * `SwaggerModule.createDocument(...)`. Adds:
 *
 *   1. Every Zod schema registered via `registerZodSchema(name, ...)`
 *      to `components.schemas` (named-component reuse for kubb).
 *   2. The RFC 7807 `ProblemDetails` schema and `ProblemDetailsResponse`
 *      reusable response, so 4xx/5xx responses can `$ref` them.
 *
 * Pre-existing entries are preserved — `@nestjs/swagger` may have
 * populated some via `@ApiExtraModels`, and we only add, never
 * overwrite.
 */
describe("Story · applyZodSchemaRegistry runner", () => {
  it("creates `components` / `components.schemas` / `components.responses` if absent", () => {
    resetZodSchemaRegistryForTests();
    const doc = {};
    applyZodSchemaRegistry(doc);
    expect(
      (doc as { components?: { schemas?: unknown; responses?: unknown } }).components,
    ).toBeDefined();
  });

  it("inserts registered Zod schemas into `components.schemas`", () => {
    resetZodSchemaRegistryForTests();
    registerZodSchema("Foo", z.object({ id: z.uuid(), name: z.string() }));
    const doc = { components: { schemas: {} as Record<string, unknown> } };
    applyZodSchemaRegistry(doc);
    expect(doc.components.schemas.Foo).toBeDefined();
  });

  it("does NOT overwrite an existing `components.schemas[name]`", () => {
    resetZodSchemaRegistryForTests();
    registerZodSchema("Foo", z.object({ id: z.uuid() }));
    const existing = { type: "object", title: "swagger-side definition" };
    const doc = { components: { schemas: { Foo: existing } as Record<string, unknown> } };
    applyZodSchemaRegistry(doc);
    expect(doc.components.schemas.Foo).toBe(existing);
  });

  it("adds the RFC 7807 `ProblemDetails` schema and `ProblemDetailsResponse`", () => {
    resetZodSchemaRegistryForTests();
    const doc = {};
    applyZodSchemaRegistry(doc);
    const schemas = (doc as { components: { schemas: Record<string, unknown> } }).components
      .schemas;
    const responses = (doc as { components: { responses: Record<string, unknown> } }).components
      .responses;
    expect(schemas.ProblemDetails).toBeDefined();
    expect(responses.ProblemDetailsResponse).toBeDefined();
  });

  it("includes project-specific APP_* error codes when passed via `appErrorCodes`", () => {
    resetZodSchemaRegistryForTests();
    const doc: { components?: { schemas?: Record<string, unknown> } } = {};
    applyZodSchemaRegistry(doc, { appErrorCodes: ["APP_FOO", "APP_BAR"] });
    const problemDetails = doc.components!.schemas!.ProblemDetails as {
      properties: { code: { enum: string[] } };
    };
    expect(problemDetails.properties.code.enum).toEqual(
      expect.arrayContaining(["APP_FOO", "APP_BAR"]),
    );
  });

  it("returns the same document reference for fluent chaining", () => {
    resetZodSchemaRegistryForTests();
    const doc = {};
    const result = applyZodSchemaRegistry(doc);
    expect(result).toBe(doc);
  });
});
