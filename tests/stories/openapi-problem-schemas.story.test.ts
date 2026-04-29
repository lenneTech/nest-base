import { describe, expect, it } from "vitest";

import { CORE_ERROR_CODES } from "../../src/core/errors/error-code.js";
import {
  buildProblemDetailsOpenApiComponents,
  type OpenApiProblemSchemasInput,
} from "../../src/core/errors/openapi-problem-schemas.js";

/**
 * Story · OpenAPI Problem-Details schemas (PLAN.md §32 Phase 8).
 *
 * Pure builder for the OpenAPI 3.1 `components` block that
 * documents the RFC 7807 problem-details responses every endpoint
 * can emit. Plugged into the Swagger setup at boot — every route
 * automatically references `#/components/schemas/ProblemDetails`
 * for its 4xx/5xx responses, with one-of `code` enum values
 * derived from `CORE_ERROR_CODES` plus any project-level codes the
 * caller hands in.
 *
 * Keeping the builder I/O-free buys deterministic snapshot diffs
 * in the generated OpenAPI document.
 */
describe("Story · OpenAPI Problem-Details schemas", () => {
  function input(overrides: Partial<OpenApiProblemSchemasInput> = {}): OpenApiProblemSchemasInput {
    return {
      coreCodes: Object.values(CORE_ERROR_CODES),
      appCodes: [],
      ...overrides,
    };
  }

  describe("top-level shape", () => {
    it("returns a `schemas` map under `components`", () => {
      const out = buildProblemDetailsOpenApiComponents(input());
      expect(out.components.schemas).toBeDefined();
    });

    it("declares the `ProblemDetails` schema", () => {
      const out = buildProblemDetailsOpenApiComponents(input());
      expect(out.components.schemas.ProblemDetails).toBeDefined();
    });

    it("declares the `ProblemDetailsResponse` reusable response", () => {
      const out = buildProblemDetailsOpenApiComponents(input());
      expect(out.components.responses.ProblemDetailsResponse).toBeDefined();
    });
  });

  describe("ProblemDetails schema", () => {
    it("matches RFC 7807 — type/title/status/code required", () => {
      const out = buildProblemDetailsOpenApiComponents(input());
      const schema = out.components.schemas.ProblemDetails!;
      expect(schema.type).toBe("object");
      expect(schema.required).toEqual(expect.arrayContaining(["type", "title", "status", "code"]));
    });

    it("documents detail + instance as optional strings", () => {
      const out = buildProblemDetailsOpenApiComponents(input());
      const schema = out.components.schemas.ProblemDetails!;
      expect(schema.properties.detail).toMatchObject({ type: "string" });
      expect(schema.properties.instance).toMatchObject({ type: "string" });
      expect(schema.required).not.toContain("detail");
      expect(schema.required).not.toContain("instance");
    });

    it("documents status as an integer 100..599", () => {
      const out = buildProblemDetailsOpenApiComponents(input());
      const status = out.components.schemas.ProblemDetails!.properties.status!;
      expect(status.type).toBe("integer");
      expect(status.minimum).toBe(100);
      expect(status.maximum).toBe(599);
    });

    it("declares `code` as a string enum drawn from coreCodes + appCodes", () => {
      const out = buildProblemDetailsOpenApiComponents(
        input({ appCodes: ["APP_CUSTOM_FOO", "APP_CUSTOM_BAR"] }),
      );
      const code = out.components.schemas.ProblemDetails!.properties.code!;
      expect(code.type).toBe("string");
      expect(code.enum).toEqual(
        expect.arrayContaining([CORE_ERROR_CODES.NOT_FOUND, "APP_CUSTOM_FOO"]),
      );
    });

    it("keeps the `code` enum sorted alphabetically (so re-running yields the same OpenAPI doc byte-for-byte)", () => {
      const out = buildProblemDetailsOpenApiComponents(
        input({ appCodes: ["APP_ZED", "APP_AAA", "APP_MMM"] }),
      );
      const code = out.components.schemas.ProblemDetails!.properties.code!;
      expect(code.enum).toEqual([...code.enum!].sort());
    });

    it("deduplicates if the same code appears in both core and app", () => {
      const out = buildProblemDetailsOpenApiComponents(
        input({ appCodes: [CORE_ERROR_CODES.NOT_FOUND, "APP_OWN"] }),
      );
      const enumValues = out.components.schemas.ProblemDetails!.properties.code!.enum!;
      const occurrences = enumValues.filter((c) => c === CORE_ERROR_CODES.NOT_FOUND).length;
      expect(occurrences).toBe(1);
    });
  });

  describe("ProblemDetailsResponse", () => {
    it("uses `application/problem+json` as the content-type (RFC 7807 §3)", () => {
      const out = buildProblemDetailsOpenApiComponents(input());
      const resp = out.components.responses.ProblemDetailsResponse!;
      expect(resp.content["application/problem+json"]).toBeDefined();
    });

    it("the response schema $refs the ProblemDetails schema", () => {
      const out = buildProblemDetailsOpenApiComponents(input());
      const resp = out.components.responses.ProblemDetailsResponse!;
      expect(resp.content["application/problem+json"]!.schema).toEqual({
        $ref: "#/components/schemas/ProblemDetails",
      });
    });
  });

  describe("determinism", () => {
    it("returns byte-identical components for byte-identical input", () => {
      const a = buildProblemDetailsOpenApiComponents(input({ appCodes: ["APP_X", "APP_Y"] }));
      const b = buildProblemDetailsOpenApiComponents(input({ appCodes: ["APP_X", "APP_Y"] }));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it("rejects an app code that does not match the standard regex", () => {
      expect(() =>
        buildProblemDetailsOpenApiComponents(input({ appCodes: ["lowercase"] })),
      ).toThrow(/code/i);
    });
  });
});
