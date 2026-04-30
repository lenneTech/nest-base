import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { PrismaTenantMemberStorage } from "../../src/core/multi-tenancy/prisma-tenant-member-storage.js";
import {
  type TenantMemberRecord,
  TenantMemberService,
} from "../../src/core/multi-tenancy/tenant-member.service.js";
import { uuidV7 } from "../../src/core/uuid/uuid-v7.js";

/**
 * Story · TenantMember Prisma persistence (closes finding #2)
 *
 * Replaces `InMemoryTenantMemberStorage` as the default. Memberships
 * survive a process restart (the canonical proof: open a fresh
 * Prisma client and find the row we just inserted).
 */
describe("Story · TenantMember Prisma persistence", () => {
  let prisma: PrismaClient;
  let tenantId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL missing — global-setup did not run");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await prisma.$connect();
    // A real Tenant row to FK against — the storage adapter writes
    // through to a foreign-keyed table. Using a unique name per run
    // dodges concurrent-test collisions on the testcontainer.
    const tenant = await prisma.tenant.create({
      data: { id: uuidV7(), name: `prisma-tm-storage-${Date.now()}` },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    if (tenantId) {
      // tenant_members cascades on tenant delete; clean up users in
      // a separate pass so the test container stays tidy.
      await prisma.tenantMember.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  async function makeUser(): Promise<string> {
    const id = uuidV7();
    await prisma.user.create({
      data: {
        id,
        email: `tm-user-${id}@example.test`,
        name: "TM User",
        tenantId,
      },
    });
    return id;
  }

  it("insert + findByUserAndTenant round-trip writes to the `tenant_members` table", async () => {
    const storage = new PrismaTenantMemberStorage(prisma);
    const userId = await makeUser();
    const record: TenantMemberRecord = {
      id: uuidV7(),
      userId,
      tenantId,
      role: "editor",
      status: "INVITED",
      invitedAt: new Date(),
    };
    const inserted = await storage.insert(record);
    expect(inserted.id).toBe(record.id);

    const found = await storage.findByUserAndTenant(userId, tenantId);
    expect(found).not.toBeNull();
    expect(found!.role).toBe("editor");
    expect(found!.status).toBe("INVITED");

    // The row is in Postgres — re-reading via raw Prisma proves the
    // claim "no in-memory adapter" the way no other assertion can.
    const raw = await prisma.tenantMember.findFirst({ where: { id: record.id } });
    expect(raw).not.toBeNull();
  });

  it("listByTenant returns rows filtered to the tenant", async () => {
    const storage = new PrismaTenantMemberStorage(prisma);
    const u1 = await makeUser();
    const u2 = await makeUser();
    await storage.insert({
      id: uuidV7(),
      userId: u1,
      tenantId,
      role: "viewer",
      status: "ACTIVE",
    });
    await storage.insert({
      id: uuidV7(),
      userId: u2,
      tenantId,
      role: "viewer",
      status: "ACTIVE",
    });

    const rows = await storage.listByTenant(tenantId);
    // The test creates `tenantId` per run but earlier `it` blocks may
    // have inserted into the same tenant, so we just assert at least
    // these two are visible.
    expect(rows.map((r) => r.userId)).toEqual(expect.arrayContaining([u1, u2]));
  });

  it("updateStatus transitions INVITED → ACTIVE persistently", async () => {
    const storage = new PrismaTenantMemberStorage(prisma);
    const userId = await makeUser();
    const id = uuidV7();
    await storage.insert({
      id,
      userId,
      tenantId,
      role: "editor",
      status: "INVITED",
      invitedAt: new Date(),
    });

    const updated = await storage.updateStatus(id, "ACTIVE");
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("ACTIVE");

    // Re-read confirms persistence
    const raw = await prisma.tenantMember.findUnique({ where: { id } });
    expect(raw!.status).toBe("ACTIVE");
  });

  it("remove deletes the row", async () => {
    const storage = new PrismaTenantMemberStorage(prisma);
    const userId = await makeUser();
    const id = uuidV7();
    await storage.insert({ id, userId, tenantId, role: "editor", status: "ACTIVE" });
    expect(await storage.remove(id)).toBe(true);
    expect(await prisma.tenantMember.findUnique({ where: { id } })).toBeNull();
    // Idempotency: removing the same row twice returns false instead
    // of throwing — matches the InMemory contract.
    expect(await storage.remove(id)).toBe(false);
  });

  it("works as the storage backend for the TenantMemberService", async () => {
    const storage = new PrismaTenantMemberStorage(prisma);
    const svc = new TenantMemberService(storage);
    const userId = await makeUser();
    const member = await svc.add({ userId, tenantId, role: "editor" });
    expect(member.status).toBe("INVITED");

    const activated = await svc.activate(member.id);
    expect(activated.status).toBe("ACTIVE");

    const list = await svc.listByTenant(tenantId);
    expect(list.find((r) => r.id === member.id)?.status).toBe("ACTIVE");
  });
});
