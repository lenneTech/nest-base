import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  registerZodSchema,
  resetZodSchemaRegistryForTests,
  zodSchemaToOpenApi,
  zodSchemaRegistryComponents,
} from "../../src/core/openapi/zod-to-openapi.js";

/**
 * Story · Zod → OpenAPI bridge.
 *
 * Pure planner that converts a Zod schema into an OpenAPI 3.0
 * SchemaObject fragment. The bridge feeds:
 *   1. The `@ApiZodBody`/`@ApiZodResponse`/`@ApiZodQuery` decorators
 *      (inline schemas).
 *   2. A named-schema registry whose contents are merged into
 *      `components.schemas` of the generated OpenAPI document so the
 *      kubb-generated SDK can `$ref` them.
 *
 * Determinism matters — re-running must yield byte-identical output
 * so the Scalar UI / SDK / OpenAPI document don't churn under no-op
 * commits.
 */
describe("Story · Zod → OpenAPI bridge", () => {
  describe("zodSchemaToOpenApi", () => {
    it("converts a primitive string schema to a JSON-Schema string fragment", () => {
      const out = zodSchemaToOpenApi(z.string().min(2).max(10));
      expect(out.type).toBe("string");
      expect(out.minLength).toBe(2);
      expect(out.maxLength).toBe(10);
    });

    it("converts an object schema with required + optional + default fields", () => {
      const schema = z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        status: z.enum(["draft", "published"]).default("draft"),
      });
      const out = zodSchemaToOpenApi(schema);
      expect(out.type).toBe("object");
      expect(out.properties?.name).toMatchObject({ type: "string", minLength: 1 });
      expect(out.properties?.description).toMatchObject({ type: "string" });
      expect(out.properties?.status).toMatchObject({
        type: "string",
        enum: ["draft", "published"],
        default: "draft",
      });
      // `name` is required (no default, not optional); `status` becomes
      // required because it has a default; `description` is optional.
      expect(out.required).toEqual(expect.arrayContaining(["name", "status"]));
      expect(out.required).not.toContain("description");
    });

    it("does NOT emit the JSON-Schema `$schema` keyword (OpenAPI doesn't allow it)", () => {
      const out = zodSchemaToOpenApi(z.object({ x: z.number() }));
      expect(out).not.toHaveProperty("$schema");
    });

    it("targets OpenAPI 3.0 (no `examples` array, no draft-2020 keywords)", () => {
      // OpenAPI 3.0 expresses optional via `required: []`, not via the
      // 2020-12 type-array trick (`["string", "null"]`). Selecting
      // openapi-3.0 keeps the output Scalar-UI- and kubb-friendly.
      const out = zodSchemaToOpenApi(z.string().nullable());
      // Either nullable: true OR an oneOf with null is acceptable; what
      // we MUST avoid is the draft-2020 type-array form.
      if (Array.isArray(out.type)) {
        throw new Error("zod-to-openapi: emitted draft-2020 type-array, not OpenAPI-3.0 friendly");
      }
    });

    it("returns deterministic output for identical input (byte-identical JSON)", () => {
      const a = zodSchemaToOpenApi(z.object({ x: z.string(), y: z.number().int() }));
      const b = zodSchemaToOpenApi(z.object({ x: z.string(), y: z.number().int() }));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });

  describe("named-schema registry", () => {
    it("registers a schema under a name and surfaces it in components.schemas", () => {
      resetZodSchemaRegistryForTests();
      registerZodSchema("MyExample", z.object({ id: z.uuid(), name: z.string() }));
      const components = zodSchemaRegistryComponents();
      expect(components.schemas.MyExample).toBeDefined();
      expect(components.schemas.MyExample!.type).toBe("object");
      expect(components.schemas.MyExample!.properties?.id).toMatchObject({
        type: "string",
        format: "uuid",
      });
    });

    it("re-registering the same name with a deep-equal schema is a no-op", () => {
      resetZodSchemaRegistryForTests();
      const schema = z.object({ id: z.uuid() });
      registerZodSchema("Foo", schema);
      // Re-registering with a value that produces the same JSON-Schema
      // output must not throw — modules can be loaded twice in test
      // environments / hot-reload scenarios.
      expect(() => registerZodSchema("Foo", z.object({ id: z.uuid() }))).not.toThrow();
      const components = zodSchemaRegistryComponents();
      expect(components.schemas.Foo).toBeDefined();
    });

    it("rejects re-registering the same name with a structurally different schema", () => {
      resetZodSchemaRegistryForTests();
      registerZodSchema("Foo", z.object({ id: z.uuid() }));
      expect(() => registerZodSchema("Foo", z.object({ id: z.string() }))).toThrow(/Foo/);
    });

    it("emits no entries when nothing has been registered", () => {
      resetZodSchemaRegistryForTests();
      const components = zodSchemaRegistryComponents();
      expect(components.schemas).toEqual({});
    });

    it("returns components.schemas in alphabetical order (deterministic doc output)", () => {
      resetZodSchemaRegistryForTests();
      registerZodSchema("Zebra", z.object({}));
      registerZodSchema("Apple", z.object({}));
      registerZodSchema("Mango", z.object({}));
      const components = zodSchemaRegistryComponents();
      expect(Object.keys(components.schemas)).toEqual(["Apple", "Mango", "Zebra"]);
    });
  });
});
