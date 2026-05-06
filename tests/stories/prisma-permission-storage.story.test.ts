import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { PrismaPermissionStorage } from "../../src/core/permissions/prisma-permission-storage.js";
import { uuidV7 } from "../../src/core/uuid/uuid-v7.js";

/**
 * Story · Prisma-backed PermissionStorage (closes blocker).
 *
 * Replaces the no-op stub. Two layers stack:
 *  1. Explicit rows — `Role → RolePolicy → Policy → Permission` that
 *     an admin authored via `/admin/*` CRUD.
 *  2. Implicit "Member" rules — synthesized in-memory whenever the
 *     user has a BA `member` row in the requested organization.
 *     BA's member table stores only active members — a found row
 *     implies membership. Without these rules, a fresh sign-up
 *     would 403 on every `@Can()` route.
 *
 * The synthesized rules are NEVER written to the DB. They live for the
 * duration of the request (and the 60s `PermissionService` cache).
 *
 * Anonymous users (no membership row) get an empty list — the
 * existing `CanGuard` behaviour (deny on unmatched rule) is preserved.
 */
describe("Story · PrismaPermissionStorage", () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let otherTenantId: string;
  // Track created user ids so we can clean them up in afterAll.
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL missing — global-setup did not run");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await prisma.$connect();
    // Organization.id is String (not UUID) in BA schema but our other
    // tables keep UUID FKs, so we use UUID-shaped strings here so that
    // Role.tenantId (still @db.Uuid) stays compatible.
    const id1 = uuidV7();
    const id2 = uuidV7();
    const t1 = await prisma.organization.create({
      data: {
        id: id1,
        name: `pps-storage-${Date.now()}`,
        slug: `pps-storage-${id1}`,
        createdAt: new Date(),
      },
    });
    const t2 = await prisma.organization.create({
      data: {
        id: id2,
        name: `pps-storage-other-${Date.now()}`,
        slug: `pps-storage-other-${id2}`,
        createdAt: new Date(),
      },
    });
    tenantId = t1.id;
    otherTenantId = t2.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.member.deleteMany({ where: { organizationId: tenantId } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.organization.delete({ where: { id: tenantId } });
    }
    if (otherTenantId) {
      await prisma.member.deleteMany({ where: { organizationId: otherTenantId } });
      await prisma.organization.delete({ where: { id: otherTenantId } });
    }
    await prisma.$disconnect();
  });

  async function makeUser(): Promise<string> {
    const id = uuidV7();
    await prisma.user.create({
      data: {
        id,
        email: `pps-${id}@example.test`,
        name: "Storage Test User",
      },
    });
    createdUserIds.push(id);
    return id;
  }

  it("returns the synthesized 'Member' rules when the user is a BA organization member", async () => {
    const storage = new PrismaPermissionStorage(prisma);
    const userId = await makeUser();
    await prisma.member.create({
      data: {
        id: uuidV7(),
        userId,
        organizationId: tenantId,
        role: "member",
        createdAt: new Date(),
      },
    });

    const rows = await storage.findRulesForUser(userId, tenantId);
    expect(rows.length).toBeGreaterThan(0);
    // Every synthesized row is `manage` on a project resource. The
    // tenant-scoped subset uses `$CURRENT_TENANT`; the per-user subset
    // (Issue #47 — ApiKey) uses `$CURRENT_USER`. The split lives in
    // `buildMemberRoleRules` and is surfaced via the
    // `DEFAULT_MEMBER_PER_USER_RESOURCES` catalogue.
    const perUserResources = new Set(["ApiKey"]);
    for (const row of rows) {
      expect(row.action).toBe("MANAGE");
      expect(row.itemFilter).toMatchObject(
        perUserResources.has(row.resource)
          ? { userId: { _eq: "$CURRENT_USER" } }
          : { tenantId: { _eq: "$CURRENT_TENANT" } },
      );
    }
  });

  it("returns an empty list when the user has no member row in the organization", async () => {
    const storage = new PrismaPermissionStorage(prisma);
    const userId = await makeUser();
    // No membership inserted — fresh user, no org link.
    const rows = await storage.findRulesForUser(userId, tenantId);
    expect(rows).toEqual([]);
  });

  it("does not leak rules from another organization", async () => {
    const storage = new PrismaPermissionStorage(prisma);
    const userId = await makeUser();
    // The user is a member of `tenantId` but we ask about `otherTenantId`.
    await prisma.member.create({
      data: {
        id: uuidV7(),
        userId,
        organizationId: tenantId,
        role: "member",
        createdAt: new Date(),
      },
    });
    const rows = await storage.findRulesForUser(userId, otherTenantId);
    expect(rows).toEqual([]);
  });

  it("merges explicit Role/Policy/Permission rows with the synthesized member rules", async () => {
    const storage = new PrismaPermissionStorage(prisma);
    const userId = await makeUser();
    // Explicit grant: a Role linked via RolePolicy → Policy → Permission
    // gives the user `READ` on `SecretSubject` (a name that won't ever
    // be in the default member list — proves the merge is real).
    const role = await prisma.role.create({
      data: { id: uuidV7(), name: `r-${Date.now()}`, tenantId },
    });
    const policy = await prisma.policy.create({
      data: { id: uuidV7(), name: `p-${Date.now()}` },
    });
    await prisma.rolePolicy.create({ data: { roleId: role.id, policyId: policy.id } });
    await prisma.permission.create({
      data: {
        id: uuidV7(),
        policyId: policy.id,
        resource: "SecretSubject",
        action: "READ",
        fields: [],
      },
    });
    await prisma.member.create({
      data: {
        id: uuidV7(),
        userId,
        organizationId: tenantId,
        role: role.name,
        createdAt: new Date(),
      },
    });

    const rows = await storage.findRulesForUser(userId, tenantId);
    const subjects = rows.map((r) => r.resource);
    // Synthesized member rules + explicit rule
    expect(subjects).toContain("SecretSubject");
    // And at least one of the default member resources
    expect(subjects.some((s) => s !== "SecretSubject")).toBe(true);

    // Cleanup
    await prisma.permission.deleteMany({ where: { policyId: policy.id } });
    await prisma.rolePolicy.deleteMany({ where: { policyId: policy.id } });
    await prisma.policy.delete({ where: { id: policy.id } });
    await prisma.role.delete({ where: { id: role.id } });
  });

  it("can be disabled via constructor option (no synthesized rules)", async () => {
    // Escape hatch for projects that ship their own seeded Member role
    // and don't want the synthesized fallback to shadow it.
    const storage = new PrismaPermissionStorage(prisma, { synthesizeMemberRules: false });
    const userId = await makeUser();
    await prisma.member.create({
      data: {
        id: uuidV7(),
        userId,
        organizationId: tenantId,
        role: "member",
        createdAt: new Date(),
      },
    });
    const rows = await storage.findRulesForUser(userId, tenantId);
    expect(rows).toEqual([]);
  });
});
