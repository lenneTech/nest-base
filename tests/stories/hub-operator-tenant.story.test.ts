import { describe, expect, it, vi } from "vitest";

import { resolveHubOperatorTenantId } from "../../src/core/hub/hub-operator-tenant.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

describe("Story · resolveHubOperatorTenantId", () => {
  const ORG = "019b76da-a800-7638-a32a-1972874a3abe";

  function prismaWithOrg(orgId: string | null): Pick<PrismaService, "member"> {
    return {
      member: {
        findFirst: vi.fn(async () => (orgId ? { organizationId: orgId } : null)),
      },
    } as unknown as Pick<PrismaService, "member">;
  }

  it("prefers activeOrganizationId without a DB lookup", async () => {
    const prisma = prismaWithOrg(ORG);
    const tenantId = await resolveHubOperatorTenantId(
      { id: "u1", activeOrganizationId: ORG },
      prisma,
    );
    expect(tenantId).toBe(ORG);
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the first BA member row when no active org is set", async () => {
    const prisma = prismaWithOrg(ORG);
    const tenantId = await resolveHubOperatorTenantId(
      { id: "u1", activeOrganizationId: null },
      prisma,
    );
    expect(tenantId).toBe(ORG);
    expect(prisma.member.findFirst).toHaveBeenCalled();
  });

  it("returns null when the user has no memberships", async () => {
    const prisma = prismaWithOrg(null);
    const tenantId = await resolveHubOperatorTenantId({ id: "u1" }, prisma);
    expect(tenantId).toBeNull();
  });
});
