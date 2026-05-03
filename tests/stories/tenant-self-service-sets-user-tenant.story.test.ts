import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { PrismaTenantSelfServiceStorage } from "../../src/core/multi-tenancy/prisma-tenant-self-service-storage.js";
import { uuidV7 } from "../../src/core/uuid/uuid-v7.js";

/**
 * Story · `createTenantWithMember` patches `User.tenantId`.
 *
 * Friction-log blocker (LLM-test 2026-05-03 #4): a freshly signed-up
 * user runs `POST /tenants` to bootstrap their first tenant — the row
 * lands, the membership lands, but `User.tenantId` stays `null`. Every
 * `@Can()` route then 403s because `AbilityMiddleware` short-circuits
 * to an empty ability when the session's `tenantId` is null.
 *
 * Defense-in-depth fix part 1: the storage adapter MUST patch
 * `User.tenantId = tenant.id` in the same transaction as the tenant +
 * membership inserts. The `where: { id, tenantId: null }` guard is
 * non-negotiable — only "claim" the user's primary tenant when they
 * don't already have one. Subsequent `POST /tenants` calls (second
 * tenant, third tenant, ...) MUST NOT silently re-flag the primary,
 * otherwise users with several memberships would lose their primary
 * context every time they create a new tenant.
 */
describe("Story · TenantSelfService → User.tenantId patch", () => {
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
      // Detach any users still pointing at this tenant before delete.
      await prisma.user.updateMany({ where: { tenantId: t.id }, data: { tenantId: null } });
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

  async function makeUser(tenantId: string | null = null): Promise<string> {
    const id = uuidV7();
    await prisma.user.create({
      data: {
        id,
        email: `tss-tenant-patch-${id}@example.test`,
        name: "Self-Service",
        ...(tenantId ? { tenantId } : {}),
      },
    });
    userIds.push(id);
    return id;
  }

  it("patches User.tenantId when the user has no primary tenant yet", async () => {
    const storage = new PrismaTenantSelfServiceStorage(prisma);
    const owner = await makeUser();
    const name = `tss-userpatch-fresh-${stamp}`;
    tenantNames.push(name);

    const tenantId = uuidV7();
    const memberId = uuidV7();
    const now = new Date();
    await storage.createTenantWithMember({
      tenant: { id: tenantId, name, createdAt: now },
      member: {
        id: memberId,
        userId: owner,
        tenantId,
        role: "owner",
        status: "ACTIVE",
        joinedAt: now,
      },
    });

    const userRow = await prisma.user.findUnique({ where: { id: owner } });
    expect(userRow).not.toBeNull();
    expect(userRow!.tenantId).toBe(tenantId);
  });

  it("does NOT overwrite User.tenantId when the user already has a primary tenant", async () => {
    const storage = new PrismaTenantSelfServiceStorage(prisma);

    // Step 1: create the user's first tenant — establishes the primary.
    const owner = await makeUser();
    const firstName = `tss-userpatch-first-${stamp}`;
    tenantNames.push(firstName);
    const firstTenantId = uuidV7();
    const firstMemberId = uuidV7();
    const now = new Date();
    await storage.createTenantWithMember({
      tenant: { id: firstTenantId, name: firstName, createdAt: now },
      member: {
        id: firstMemberId,
        userId: owner,
        tenantId: firstTenantId,
        role: "owner",
        status: "ACTIVE",
        joinedAt: now,
      },
    });
    const afterFirst = await prisma.user.findUnique({ where: { id: owner } });
    expect(afterFirst!.tenantId).toBe(firstTenantId);

    // Step 2: same user creates a second tenant. The User.tenantId
    // pointer must stay on the FIRST tenant — silently re-primaring
    // would break "current tenant" semantics for users with multiple
    // memberships.
    const secondName = `tss-userpatch-second-${stamp}`;
    tenantNames.push(secondName);
    const secondTenantId = uuidV7();
    const secondMemberId = uuidV7();
    await storage.createTenantWithMember({
      tenant: { id: secondTenantId, name: secondName, createdAt: now },
      member: {
        id: secondMemberId,
        userId: owner,
        tenantId: secondTenantId,
        role: "owner",
        status: "ACTIVE",
        joinedAt: now,
      },
    });
    const afterSecond = await prisma.user.findUnique({ where: { id: owner } });
    expect(afterSecond!.tenantId).toBe(firstTenantId);
  });
});
