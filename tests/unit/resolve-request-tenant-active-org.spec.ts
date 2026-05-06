import { describe, expect, it, vi } from "vitest";

import { resolveRequestTenantId } from "../../src/core/multi-tenancy/resolve-request-tenant.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Unit tests for the `session.activeOrganizationId` fallback in
 * `resolveRequestTenantId` (issue #103).
 *
 * These tests exercise the pure-function logic of the tenant resolver
 * in isolation — no NestJS bootstrap, no DB, no HTTP layer. The scenario:
 * an authenticated user whose Better-Auth session carries an
 * `activeOrganizationId` should have that id resolved as the tenant
 * context when no explicit `x-tenant-id` header is present.
 */
describe("resolveRequestTenantId · activeOrganizationId fallback (issue #103)", () => {
  const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  type Req = {
    user?: { id: string; tenantId: string | null; activeOrganizationId?: string | null };
    headers?: Record<string, string | string[] | undefined>;
  };

  function noDbPrisma(): PrismaService {
    return {
      tenantMember: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaService;
  }

  it("returns activeOrganizationId when no header is present", async () => {
    const prisma = noDbPrisma();
    const req: Req = {
      user: { id: "u1", tenantId: null, activeOrganizationId: TENANT_A },
      headers: {},
    };
    expect(await resolveRequestTenantId(req as never, prisma)).toBe(TENANT_A);
    // No membership lookup — the org id comes straight from the session.
    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
  });

  it("prefers activeOrganizationId over tenantId when both are set and no header is present", async () => {
    const prisma = noDbPrisma();
    const req: Req = {
      user: { id: "u1", tenantId: TENANT_B, activeOrganizationId: TENANT_A },
      headers: {},
    };
    expect(await resolveRequestTenantId(req as never, prisma)).toBe(TENANT_A);
  });

  it("falls back to tenantId when activeOrganizationId is null", async () => {
    const prisma = noDbPrisma();
    const req: Req = {
      user: { id: "u1", tenantId: TENANT_B, activeOrganizationId: null },
      headers: {},
    };
    expect(await resolveRequestTenantId(req as never, prisma)).toBe(TENANT_B);
  });

  it("falls back to tenantId when activeOrganizationId is undefined (plugin disabled)", async () => {
    const prisma = noDbPrisma();
    const req: Req = {
      user: { id: "u1", tenantId: TENANT_B, activeOrganizationId: undefined },
      headers: {},
    };
    expect(await resolveRequestTenantId(req as never, prisma)).toBe(TENANT_B);
  });

  it("header still wins over activeOrganizationId when both are present", async () => {
    // The x-tenant-id header is the explicit per-request override and
    // always takes precedence over any session-derived value.
    const prisma = {
      tenantMember: {
        findFirst: vi.fn(async () => ({ id: "m1", status: "ACTIVE" })),
      },
    } as unknown as PrismaService;
    const req: Req = {
      user: { id: "u1", tenantId: null, activeOrganizationId: TENANT_B },
      headers: { "x-tenant-id": TENANT_A },
    };
    expect(await resolveRequestTenantId(req as never, prisma)).toBe(TENANT_A);
  });

  it("returns null when user has no activeOrganizationId and no tenantId and no header", async () => {
    const prisma = noDbPrisma();
    const req: Req = {
      user: { id: "u1", tenantId: null, activeOrganizationId: null },
      headers: {},
    };
    expect(await resolveRequestTenantId(req as never, prisma)).toBeNull();
  });
});
