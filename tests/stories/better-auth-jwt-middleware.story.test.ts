import { describe, expect, it } from "vitest";

import { isPathProtected } from "../../src/core/auth/jwt-middleware.js";

/**
 * Story · Better-Auth JWT middleware
 *
 * The middleware is allowlist-driven: by default everything except the
 * explicit public paths needs a valid JWT. Known public paths: /, /health/*,
 * the Better-Auth handler base, and the Scalar docs (when
 * enabled). Everything else requires a session or scoped API key.
 */
describe("Story · Better-Auth JWT middleware", () => {
  const publicPaths = [
    "/",
    "/health/live",
    "/health/ready",
    "/api/auth/sign-in",
    "/api/auth/sign-up",
  ];

  it.each(publicPaths)("treats %s as public (no JWT required)", (path) => {
    expect(isPathProtected(path)).toBe(false);
  });

  it("treats the resource API path as protected", () => {
    expect(isPathProtected("/api/users")).toBe(true);
    expect(isPathProtected("/api/files/abc")).toBe(true);
  });

  it("rejects empty paths defensively", () => {
    expect(() => isPathProtected("")).toThrow();
  });
});
