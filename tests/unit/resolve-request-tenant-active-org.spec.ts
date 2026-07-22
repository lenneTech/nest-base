import { describe, expect, it, vi } from "vitest";

import { resolveRequestTenantId } from "../../src/core/multi-tenancy/resolve-request-tenant.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Unit tests for session-only tenant resolution (issue #103 / session-only migration).
 */
describe("resolveRequestTenantId · activeOrganizationId (session-only)", () => {
  const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when activeOrganizationId is null", async () => {
    const prisma = noDbPrisma();
    const req: Req = {
      user: { id: "u1", activeOrganizationId: null },
      headers: {},
    };
    expect(await resolveRequestTenantId(req as never, prisma)).toBeNull();
  });

  it("ignores x-tenant-id on /hub/admin/* and keeps activeOrganizationId", async () => {
    const prisma = noDbPrisma();
    const req: Req = {
      user: { id: "u1", activeOrganizationId: TENANT_B },
      headers: { "x-tenant-id": TENANT_A },
    };
    expect(await resolveRequestTenantId(req as never, prisma, { path: "/hub/admin/roles" })).toBe(
      TENANT_B,
    );
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it("ignores x-tenant-id on /api/* and keeps activeOrganizationId", async () => {
    const prisma = noDbPrisma();
    const req: Req = {
      user: { id: "u1", activeOrganizationId: TENANT_B },
      headers: { "x-tenant-id": TENANT_A },
    };
    expect(await resolveRequestTenantId(req as never, prisma, { path: "/api/examples" })).toBe(
      TENANT_B,
    );
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });
});
