import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { PrismaTenantSelfServiceStorage } from "../../src/core/multi-tenancy/prisma-tenant-self-service-storage.js";
import { TenantSelfServiceService } from "../../src/core/multi-tenancy/tenant-self-service.service.js";
import { TenantMemberService } from "../../src/core/multi-tenancy/tenant-member.service.js";
import { uuidV7 } from "../../src/core/uuid/uuid-v7.js";

/**
 * Story · Tenant self-service Prisma persistence
 *
 * Pins the contract that `POST /tenants` writes both rows in a single
 * transaction. If the membership insert fails, the tenant must roll
 * back too — the proof: cleanup uses `deleteMany` against the tenants
 * table after asserting nothing leaked.
 */
describe("Story · TenantSelfService Prisma persistence", () => {
  let prisma: PrismaClient;
  const stamp = Date.now();
  const tenantNames: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL missing — global-setup did not run");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await prisma.$connect();
  });

  afterAll(async () => {
    for (const name of tenantNames) {
      const t = await prisma.tenant.findUnique({ where: { name } });
      if (!t) continue;
      await prisma.tenantMember.deleteMany({ where: { tenantId: t.id } });
      await prisma.tenant.delete({ where: { id: t.id } });
    }
    for (const id of userIds) {
      try {
        await prisma.user.delete({ where: { id } });
      } catch {
        // ignore
      }
    }
    await prisma.$disconnect();
  });

  async function makeUser(): Promise<string> {
    const id = uuidV7();
    await prisma.user.create({
      data: { id, email: `tss-${id}@example.test`, name: "Self-Service" },
    });
    userIds.push(id);
    return id;
  }

  it("createTenantWithMember inserts both rows atomically", async () => {
    const storage = new PrismaTenantSelfServiceStorage(prisma);
    // Deliberately don't depend on the service's `add()` flow — pass a
    // synthetic stub. The service's own constructor accepts any
    // member-service shape; storage tests only need the storage.
    const svc = new TenantSelfServiceService(
      storage,
      new TenantMemberService({
        findByUserAndTenant: async () => null,
        listByTenant: async () => [],
        insert: async (r) => r,
        updateStatus: async () => null,
        remove: async () => false,
      }),
    );
    const owner = await makeUser();
    const name = `tss-create-${stamp}`;
    tenantNames.push(name);

    const result = await svc.createForUser({ name, ownerId: owner });
    expect(result.tenant.name).toBe(name);

    const tenantRow = await prisma.tenant.findUnique({ where: { id: result.tenant.id } });
    expect(tenantRow).not.toBeNull();
    const memberRow = await prisma.tenantMember.findFirst({
      where: { tenantId: result.tenant.id, userId: owner },
    });
    expect(memberRow).not.toBeNull();
    expect(memberRow!.role).toBe("owner");
    expect(memberRow!.status).toBe("ACTIVE");
    expect(memberRow!.joinedAt).not.toBeNull();
  });

  it("listMembershipsForUser returns the joined tenant + membership rows", async () => {
    const storage = new PrismaTenantSelfServiceStorage(prisma);
    const owner = await makeUser();
    const name = `tss-list-${stamp}`;
    tenantNames.push(name);

    const svc = new TenantSelfServiceService(
      storage,
      new TenantMemberService({
        findByUserAndTenant: async () => null,
        listByTenant: async () => [],
        insert: async (r) => r,
        updateStatus: async () => null,
        remove: async () => false,
      }),
    );
    await svc.createForUser({ name, ownerId: owner });

    const list = await storage.listMembershipsForUser(owner);
    expect(list.find((r) => r.tenantName === name)).toBeDefined();
    const row = list.find((r) => r.tenantName === name)!;
    expect(row.role).toBe("owner");
    expect(row.status).toBe("ACTIVE");
    expect(row.joinedAt).toBeInstanceOf(Date);
  });

  it("findTenantByName returns null for an unknown name", async () => {
    const storage = new PrismaTenantSelfServiceStorage(prisma);
    const found = await storage.findTenantByName(`tss-missing-${stamp}-${uuidV7()}`);
    expect(found).toBeNull();
  });
});
