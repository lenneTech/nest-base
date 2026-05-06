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

  // After issue #118, User.tenantId is dropped. The resolver uses
  // session.activeOrganizationId as the sole no-header fallback.
  type Req = {
    user?: { id: string; activeOrganizationId?: string | null };
    headers?: Record<string, string | string[] | undefined>;
  };

  function noDbPrisma(): PrismaService {
    return {
      member: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaService;
  }

  it("returns activeOrganizationId when no header is present", async () => {
    const prisma = noDbPrisma();
    const req: Req = {
      user: { id: "u1", activeOrganizationId: TENANT_A },
      headers: {},
    };
    expect(await resolveRequestTenantId(req as never, prisma)).toBe(TENANT_A);
    // No membership lookup — the org id comes straight from the session.
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when activeOrganizationId is null and no header", async () => {
    // After issue #118 there is no User.tenantId fallback — null means no tenant context.
    const prisma = noDbPrisma();
    const req: Req = {
      user: { id: "u1", activeOrganizationId: null },
      headers: {},
    };
    expect(await resolveRequestTenantId(req as never, prisma)).toBeNull();
  });

  it("returns null when activeOrganizationId is undefined (plugin disabled)", async () => {
    // No fallback to a legacy tenantId field — just null.
    const prisma = noDbPrisma();
    const req: Req = {
      user: { id: "u1", activeOrganizationId: undefined },
      headers: {},
    };
    expect(await resolveRequestTenantId(req as never, prisma)).toBeNull();
  });

  it("header still wins over activeOrganizationId when both are present", async () => {
    // The x-tenant-id header is the explicit per-request override and
    // always takes precedence over any session-derived value.
    const prisma = {
      member: {
        findFirst: vi.fn(async () => ({ id: "m1" })),
      },
    } as unknown as PrismaService;
    const req: Req = {
      user: { id: "u1", activeOrganizationId: TENANT_B },
      headers: { "x-tenant-id": TENANT_A },
    };
    expect(await resolveRequestTenantId(req as never, prisma)).toBe(TENANT_A);
  });

  it("returns null when user has no activeOrganizationId and no header", async () => {
    const prisma = noDbPrisma();
    const req: Req = {
      user: { id: "u1", activeOrganizationId: null },
      headers: {},
    };
    expect(await resolveRequestTenantId(req as never, prisma)).toBeNull();
  });
});
