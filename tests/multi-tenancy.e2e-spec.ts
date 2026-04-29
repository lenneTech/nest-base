import { describe, expect, it } from "vitest";

import {
  parseTenantHeader,
  resolveTenantHeaderName,
  TenantIsolationError,
} from "../src/core/multi-tenancy/tenant-header.js";

/**
 * Adapted from nest-server `multi-tenancy.e2e-spec.ts`.
 *
 * Tenant isolation hinges on a header that the API consumes on every
 * request. The contract:
 *   - header name comes from `features.multiTenancy.headerName` (default
 *     `x-tenant-id`)
 *   - header value MUST be a UUID — anything else is rejected with the
 *     `TenantIsolationError` so RLS never sees garbage
 */
describe("Multi-tenancy · Tenant header", () => {
  it("default header name is `x-tenant-id`", () => {
    expect(
      resolveTenantHeaderName({
        multiTenancy: { headerName: "x-tenant-id", enabled: true, rls: true },
      }),
    ).toBe("x-tenant-id");
  });

  it("honors a custom header name from features.multiTenancy.headerName", () => {
    expect(
      resolveTenantHeaderName({
        multiTenancy: { headerName: "X-NST-Tenant", enabled: true, rls: true },
      }),
    ).toBe("X-NST-Tenant");
  });

  it("parseTenantHeader() accepts a valid UUID", () => {
    const tenantId = "0af76519-16cd-43dd-8448-eb211c80319c";
    expect(parseTenantHeader(tenantId)).toBe(tenantId);
  });

  it("parseTenantHeader() throws TenantIsolationError on a non-UUID value", () => {
    expect(() => parseTenantHeader("not-a-uuid")).toThrow(TenantIsolationError);
  });

  it("parseTenantHeader() throws on an empty value", () => {
    expect(() => parseTenantHeader("")).toThrow(TenantIsolationError);
  });

  it("parseTenantHeader() picks the first value when the header arrives as an array", () => {
    const tenantId = "0af76519-16cd-43dd-8448-eb211c80319c";
    expect(parseTenantHeader([tenantId, "second"])).toBe(tenantId);
  });
});
