import { describe, expect, it, vi } from "vitest";

import { resolveRequestTenantId } from "../../src/core/multi-tenancy/resolve-request-tenant.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Story · `resolveRequestTenantId(req, prisma, { path })`
 *
 * Tenant scope comes only from `session.activeOrganizationId` (Better-Auth
 * `POST /api/auth/organization/set-active`). Stray `x-tenant-id` headers are
 * ignored on every path.
 */
describe("Story · resolveRequestTenantId", () => {
  const VALID_TENANT_A = "00000000-0000-4000-8000-000000000001";
  const VALID_TENANT_B = "00000000-0000-4000-8000-000000000002";
  type Req = {
    user?: { id: string; activeOrganizationId?: string | null };
    headers?: Record<string, string | string[] | undefined>;
  };

  function makePrisma(): PrismaService {
    return { member: { findFirst: vi.fn() } } as unknown as PrismaService;
  }

  it("returns session.activeOrganizationId on /api/* and ignores a stray header", async () => {
    const prisma = makePrisma();
    const req: Req = {
      user: { id: "u1", activeOrganizationId: VALID_TENANT_B },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    const result = await resolveRequestTenantId(req as never, prisma, {
      path: "/api/examples",
    });
    expect(result).toBe(VALID_TENANT_B);
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it("returns session.activeOrganizationId on /hub/admin/* and ignores the header", async () => {
    const prisma = makePrisma();
    const req: Req = {
      user: { id: "u1", activeOrganizationId: VALID_TENANT_B },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    const result = await resolveRequestTenantId(req as never, prisma, {
      path: "/hub/admin/roles",
    });
    expect(result).toBe(VALID_TENANT_B);
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when no session org is active", async () => {
    const prisma = makePrisma();
    const req: Req = {
      user: { id: "u1", activeOrganizationId: null },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    expect(
      await resolveRequestTenantId(req as never, prisma, { path: "/hub/admin/users" }),
    ).toBeNull();
  });

  it("ignores malformed x-tenant-id headers (session is the only source)", async () => {
    const prisma = makePrisma();
    const req: Req = {
      user: { id: "u1", activeOrganizationId: VALID_TENANT_A },
      headers: { "x-tenant-id": "not-a-uuid" },
    };
    expect(await resolveRequestTenantId(req as never, prisma, { path: "/hub/admin/users" })).toBe(
      VALID_TENANT_A,
    );
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });
});
