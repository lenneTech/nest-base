import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isPathProtected } from "../../src/core/auth/jwt-middleware.js";

/**
 * Story · Better-Auth JWT middleware
 *
 * The middleware is allowlist-driven: by default everything except the
 * explicit public paths needs a valid JWT. Known public paths: /, /health/*,
 * the Better-Auth handler base, and the Scalar docs (when
 * enabled). Everything else requires a session or scoped API key.
 *
 * MAJ-2: When `OPENAPI_REQUIRE_AUTH=true` (default in production), the
 * OpenAPI spec endpoints are gated — they require a valid JWT session.
 */
describe("Story · Better-Auth JWT middleware", () => {
  // Hub and admin SPA pages now live at /hub/* and /admin/* (no /api prefix).
  // Error catalogue at /errors (no /api prefix); OpenAPI SPA page at /openapi.
  const publicPaths = [
    "/",
    "/health/live",
    "/health/ready",
    "/api/auth/sign-in",
    "/api/auth/sign-up",
    "/errors",
    "/errors/CORE_NOT_FOUND",
    "/openapi",
    "/api/openapi.json",
    "/hub/login",
    "/hub/logout",
    "/hub",
  ];

  // Tests run with NODE_ENV=test which resolves to "not production", so
  // OPENAPI_REQUIRE_AUTH defaults to false and OpenAPI paths remain public.
  it.each(publicPaths)("treats %s as public (no JWT required) in dev/test mode", (path) => {
    expect(isPathProtected(path)).toBe(false);
  });

  it("treats the resource API path as protected", () => {
    expect(isPathProtected("/api/users")).toBe(true);
    expect(isPathProtected("/api/files/abc")).toBe(true);
  });

  it("rejects empty paths defensively", () => {
    expect(() => isPathProtected("")).toThrow();
  });

  describe("MAJ-2: OpenAPI auth gating", () => {
    let savedEnv: string | undefined;

    beforeEach(() => {
      savedEnv = process.env.OPENAPI_REQUIRE_AUTH;
    });

    afterEach(() => {
      if (savedEnv === undefined) {
        delete process.env.OPENAPI_REQUIRE_AUTH;
      } else {
        process.env.OPENAPI_REQUIRE_AUTH = savedEnv;
      }
    });

    it("treats OpenAPI paths as protected when OPENAPI_REQUIRE_AUTH=true", () => {
      process.env.OPENAPI_REQUIRE_AUTH = "true";
      expect(isPathProtected("/api/openapi.json")).toBe(true);
      expect(isPathProtected("/openapi")).toBe(true);
      expect(isPathProtected("/api-docs-json")).toBe(true);
    });

    it("treats OpenAPI paths as public when OPENAPI_REQUIRE_AUTH=false", () => {
      process.env.OPENAPI_REQUIRE_AUTH = "false";
      expect(isPathProtected("/api/openapi.json")).toBe(false);
      expect(isPathProtected("/openapi")).toBe(false);
    });

    it("non-OpenAPI public paths remain public regardless of OPENAPI_REQUIRE_AUTH", () => {
      process.env.OPENAPI_REQUIRE_AUTH = "true";
      expect(isPathProtected("/health/live")).toBe(false);
      expect(isPathProtected("/errors")).toBe(false);
      expect(isPathProtected("/hub/login")).toBe(false);
    });
  });
});
