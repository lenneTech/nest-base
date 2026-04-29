import { describe, expect, it } from "vitest";

import {
  CORE_ERROR_CODE_PREFIX,
  CORE_ERROR_CODES,
  ProblemDetailsSchema,
  problemDetails,
} from "../../src/core/errors/error-code.js";

/**
 * Adapted from nest-server `error-code.story.test.ts`.
 *
 * Story: every error response on the API follows RFC 7807 Problem Details.
 * Library/framework codes are prefixed with `CORE_` (PLAN.md §28.8/#22);
 * project-app codes use `APP_*` and live in `src/modules/`.
 *
 * What this iteration covers — the contract level only:
 *  - registry of CORE_* codes exists
 *  - all CORE_* codes carry the prefix
 *  - `problemDetails()` returns an object that validates against the Zod schema
 *
 * Edge-case e2e tests (status-code mapping, exception-filter wiring,
 * `ERROR_DOC_BASE_URL` resolution) follow when the NestJS app boots.
 */
describe("Story · Error Codes (RFC 7807 + CORE_* convention)", () => {
  it("exposes CORE_ as the framework-level error-code prefix", () => {
    expect(CORE_ERROR_CODE_PREFIX).toBe("CORE_");
  });

  it("every registered core code starts with CORE_", () => {
    for (const code of Object.values(CORE_ERROR_CODES)) {
      expect(code.startsWith("CORE_")).toBe(true);
    }
  });

  it("registry has at minimum INTERNAL, NOT_FOUND, UNAUTHORIZED, FORBIDDEN, VALIDATION", () => {
    expect(CORE_ERROR_CODES.INTERNAL).toBeDefined();
    expect(CORE_ERROR_CODES.NOT_FOUND).toBeDefined();
    expect(CORE_ERROR_CODES.UNAUTHORIZED).toBeDefined();
    expect(CORE_ERROR_CODES.FORBIDDEN).toBeDefined();
    expect(CORE_ERROR_CODES.VALIDATION).toBeDefined();
  });

  it("problemDetails() returns RFC 7807 shape that validates against ProblemDetailsSchema", () => {
    const detail = problemDetails({
      code: CORE_ERROR_CODES.NOT_FOUND,
      status: 404,
      title: "User not found",
      detail: "No user with id=42",
      instance: "/users/42",
    });

    expect(detail).toMatchObject({
      type: expect.stringContaining("NOT_FOUND"),
      title: "User not found",
      status: 404,
      detail: "No user with id=42",
      instance: "/users/42",
      code: CORE_ERROR_CODES.NOT_FOUND,
    });

    const parsed = ProblemDetailsSchema.safeParse(detail);
    expect(parsed.success).toBe(true);
  });

  it("ProblemDetailsSchema rejects responses without a code", () => {
    const parsed = ProblemDetailsSchema.safeParse({
      type: "about:blank",
      title: "Bad",
      status: 400,
    });
    expect(parsed.success).toBe(false);
  });
});
