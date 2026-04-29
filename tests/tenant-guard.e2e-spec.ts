import { describe, expect, it } from "vitest";

import { isTenantExempt, requiresTenant } from "../src/core/multi-tenancy/tenant-guard.js";

/**
 * Adapted from nest-server `tenant-guard.e2e-spec.ts`.
 *
 * Path-level guard rules:
 *   - public paths (/health/*, /, /api/auth/*) are exempt from the
 *     tenant header check
 *   - everything else requires the tenant header to be present + valid
 *
 * The integration into NestJS lands in the next slice — these helpers
 * pin the path-classification before the guard exists.
 */
describe("Tenant Guard", () => {
  it.each(["/", "/health/live", "/health/ready", "/api/auth/sign-in", "/api/auth/sign-up"])(
    "treats %s as tenant-exempt",
    (path) => {
      expect(isTenantExempt(path)).toBe(true);
      expect(requiresTenant(path)).toBe(false);
    },
  );

  it.each(["/api/users", "/api/files", "/api/projects/abc"])(
    "treats %s as tenant-required",
    (path) => {
      expect(requiresTenant(path)).toBe(true);
    },
  );

  it("rejects empty input defensively", () => {
    expect(() => requiresTenant("")).toThrow();
  });

  it("strips query strings before matching exempt prefixes", () => {
    expect(isTenantExempt("/errors?format=json")).toBe(true);
    expect(isTenantExempt("/health/live?ts=1")).toBe(true);
    expect(isTenantExempt("/api/auth/sign-in?next=/x")).toBe(true);
    expect(isTenantExempt("/dev?source=banner")).toBe(true);
  });

  it("strips fragments before matching", () => {
    expect(isTenantExempt("/errors#section")).toBe(true);
  });
});
