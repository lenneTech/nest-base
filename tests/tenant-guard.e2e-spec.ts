import { describe, expect, it } from "vitest";

import { isTenantExempt, requiresTenant } from "../src/core/multi-tenancy/tenant-guard.js";

/**
 * Adapted from nest-server `tenant-guard.e2e-spec.ts`.
 *
 * Path-level guard rules:
 *   - public paths (/health/*, /, /api/auth/*) are exempt from tenant scope
 *   - `/hub/*` and `/admin/*` require `session.activeOrganizationId`
 *   - everything else requires the tenant header to be present + valid
 *
 * Issue #83: all domain API routes are now under `/api/*`. The
 * self-service paths (`/me/*`, `/tenants`) also moved to `/api/me/*`
 * and `/api/tenants`.
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

  // `/api/me/*` endpoints operate on the authenticated user (req.user.id),
  // not on a specific tenant — they are exempt from the tenant header.
  // `/api/tenants` (self-service tenant CRUD) is the bootstrap surface a
  // signed-up user uses to create their first tenant; it cannot
  // require a tenant id since none exists yet.
  it.each([
    "/api/me/tenants",
    "/api/me/devices",
    "/api/tenants",
    "/api/tenants/",
    "/api/tenants/abc",
  ])("treats %s as tenant-exempt (self-service / per-user surface)", (path) => {
    expect(isTenantExempt(path)).toBe(true);
  });

  it.each(["/hub", "/hub/dashboard.json", "/hub/portal-access.json", "/admin/tenants/list.json"])(
    "treats %s as tenant-required (session active org)",
    (path) => {
      expect(requiresTenant(path)).toBe(true);
      expect(isTenantExempt(path)).toBe(false);
    },
  );

  it("rejects empty input defensively", () => {
    expect(() => requiresTenant("")).toThrow();
  });

  it("strips query strings before matching exempt prefixes", () => {
    // /errors is the canonical path (no /api prefix); /api/errors kept for backward compat.
    expect(isTenantExempt("/errors?format=json")).toBe(true);
    expect(isTenantExempt("/api/errors?format=json")).toBe(true);
    expect(isTenantExempt("/health/live?ts=1")).toBe(true);
    expect(isTenantExempt("/api/auth/sign-in?next=/x")).toBe(true);
    expect(requiresTenant("/hub/dashboard.json?refresh=1")).toBe(true);
  });

  it("strips fragments before matching", () => {
    expect(isTenantExempt("/errors#section")).toBe(true);
    expect(isTenantExempt("/api/errors#section")).toBe(true);
  });
});
