import { describe, expect, it } from "vitest";

import { buildSeedPlan } from "../../src/core/setup/seed-plan.js";

/**
 * Story · `bun run seed`.
 *
 * Pure planner producing a structured "what should exist in the DB
 * after seeding" object. The runner uses Prisma to upsert each
 * record. Idempotent — re-running the seed must not create
 * duplicates (every record uses a deterministic id derived from a
 * stable seed string).
 *
 * Demo data shape (issue #85):
 *   - 1 tenant ("Lenne Tech", slug "lenne")
 *   - 3 roles: "System Admin" (isSystem=true), "Admin", "User"
 *   - 1 policy per role (named after the role) + permission rows
 *   - 3 users: system-admin@lenne.tech, admin@lenne.tech, user@lenne.tech
 *   - 1 UserProfile per user with deterministic placeholder data
 *   - 1 TenantMember per user (status=ACTIVE)
 */
describe("Story · buildSeedPlan", () => {
  it("returns exactly 1 tenant — Lenne Tech / lenne", () => {
    const plan = buildSeedPlan();
    expect(plan.tenants).toHaveLength(1);
    const [tenant] = plan.tenants;
    expect(tenant!.name).toBe("Lenne Tech");
    expect(tenant!.slug).toBe("lenne");
    expect(tenant!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("returns 3 roles — System Admin (isSystem=true), Admin, User", () => {
    const plan = buildSeedPlan();
    expect(plan.roles).toHaveLength(3);
    const names = plan.roles.map((r) => r.name).sort();
    expect(names).toEqual(["Admin", "System Admin", "User"]);
    const systemAdmin = plan.roles.find((r) => r.name === "System Admin");
    const admin = plan.roles.find((r) => r.name === "Admin");
    const user = plan.roles.find((r) => r.name === "User");
    expect(systemAdmin!.isSystem).toBe(true);
    expect(admin!.isSystem).toBe(false);
    expect(user!.isSystem).toBe(false);
  });

  it("roles are scoped to the single tenant", () => {
    const plan = buildSeedPlan();
    const tenantId = plan.tenants[0]!.id;
    for (const role of plan.roles) {
      expect(role.tenantId).toBe(tenantId);
    }
  });

  it("returns 3 policies — one per role — with unique names", () => {
    const plan = buildSeedPlan();
    expect(plan.policies).toHaveLength(3);
    const names = new Set(plan.policies.map((p) => p.name));
    expect(names.size).toBe(3);
  });

  it("every role has exactly one RolePolicy linking it to its policy", () => {
    const plan = buildSeedPlan();
    expect(plan.rolePolicies).toHaveLength(3);
    const roleIds = new Set(plan.rolePolicies.map((rp) => rp.roleId));
    const policyIds = new Set(plan.rolePolicies.map((rp) => rp.policyId));
    expect(roleIds.size).toBe(3);
    expect(policyIds.size).toBe(3);
  });

  it("System Admin policy has a bypass manage:all permission", () => {
    const plan = buildSeedPlan();
    const systemAdminRole = plan.roles.find((r) => r.name === "System Admin")!;
    const rp = plan.rolePolicies.find((rp) => rp.roleId === systemAdminRole.id)!;
    const policy = plan.policies.find((p) => p.id === rp.policyId)!;
    const perms = plan.permissions.filter((p) => p.policyId === policy.id);
    const bypassPerm = perms.find((p) => p.action === "MANAGE" && p.resource === "all");
    expect(bypassPerm).toBeDefined();
    // No item filter — full bypass
    expect(bypassPerm!.itemFilter).toBeNull();
  });

  it("Admin policy has manage permissions on project resources scoped to $CURRENT_TENANT", () => {
    const plan = buildSeedPlan();
    const adminRole = plan.roles.find((r) => r.name === "Admin")!;
    const rp = plan.rolePolicies.find((rp) => rp.roleId === adminRole.id)!;
    const policy = plan.policies.find((p) => p.id === rp.policyId)!;
    const perms = plan.permissions.filter((p) => p.policyId === policy.id);
    expect(perms.length).toBeGreaterThan(0);
    for (const perm of perms) {
      expect(perm.action).toBe("MANAGE");
      expect(perm.itemFilter).toMatchObject({ tenantId: { _eq: "$CURRENT_TENANT" } });
    }
  });

  it("User policy has READ on project resources scoped to $CURRENT_TENANT", () => {
    const plan = buildSeedPlan();
    const userRole = plan.roles.find((r) => r.name === "User")!;
    const rp = plan.rolePolicies.find((rp) => rp.roleId === userRole.id)!;
    const policy = plan.policies.find((p) => p.id === rp.policyId)!;
    const perms = plan.permissions.filter((p) => p.policyId === policy.id);
    const readPerms = perms.filter((p) => p.action === "READ");
    expect(readPerms.length).toBeGreaterThan(0);
    for (const perm of readPerms) {
      expect(perm.itemFilter).toMatchObject({ tenantId: { _eq: "$CURRENT_TENANT" } });
    }
  });

  it("User policy has UPDATE on User/UserProfile scoped to $CURRENT_USER", () => {
    const plan = buildSeedPlan();
    const userRole = plan.roles.find((r) => r.name === "User")!;
    const rp = plan.rolePolicies.find((rp) => rp.roleId === userRole.id)!;
    const policy = plan.policies.find((p) => p.id === rp.policyId)!;
    const perms = plan.permissions.filter((p) => p.policyId === policy.id);
    const updateUser = perms.find(
      (p) =>
        p.action === "UPDATE" &&
        p.resource === "User" &&
        p.itemFilter &&
        (p.itemFilter as Record<string, unknown>)["userId"] !== undefined,
    );
    const updateProfile = perms.find(
      (p) =>
        p.action === "UPDATE" &&
        p.resource === "UserProfile" &&
        p.itemFilter &&
        (p.itemFilter as Record<string, unknown>)["userId"] !== undefined,
    );
    expect(updateUser).toBeDefined();
    expect(updateProfile).toBeDefined();
  });

  it("returns exactly 3 users with the correct emails", () => {
    const plan = buildSeedPlan();
    expect(plan.users).toHaveLength(3);
    const emails = plan.users.map((u) => u.email).sort();
    expect(emails).toEqual(["admin@lenne.tech", "system-admin@lenne.tech", "user@lenne.tech"]);
  });

  it("each user has emailVerified=true", () => {
    const plan = buildSeedPlan();
    for (const user of plan.users) {
      expect(user.emailVerified).toBe(true);
    }
  });

  it("each user has a password (local-part of email)", () => {
    const plan = buildSeedPlan();
    const systemAdmin = plan.users.find((u) => u.email === "system-admin@lenne.tech")!;
    const admin = plan.users.find((u) => u.email === "admin@lenne.tech")!;
    const user = plan.users.find((u) => u.email === "user@lenne.tech")!;
    expect(systemAdmin.password).toBe("system-admin");
    expect(admin.password).toBe("admin");
    expect(user.password).toBe("user");
  });

  it("each user belongs to the single tenant", () => {
    const plan = buildSeedPlan();
    const tenantId = plan.tenants[0]!.id;
    for (const user of plan.users) {
      expect(user.tenantId).toBe(tenantId);
    }
  });

  it("returns exactly 3 tenant members — one per user, all ACTIVE", () => {
    const plan = buildSeedPlan();
    expect(plan.tenantMembers).toHaveLength(3);
    for (const member of plan.tenantMembers) {
      expect(member.status).toBe("ACTIVE");
    }
  });

  it("each tenant member role matches the user's assigned role name", () => {
    const plan = buildSeedPlan();
    const memberByUserId = new Map(plan.tenantMembers.map((m) => [m.userId, m]));

    const systemAdminUser = plan.users.find((u) => u.email === "system-admin@lenne.tech")!;
    const adminUser = plan.users.find((u) => u.email === "admin@lenne.tech")!;
    const userUser = plan.users.find((u) => u.email === "user@lenne.tech")!;

    expect(memberByUserId.get(systemAdminUser.id)!.role).toBe("System Admin");
    expect(memberByUserId.get(adminUser.id)!.role).toBe("Admin");
    expect(memberByUserId.get(userUser.id)!.role).toBe("User");
  });

  it("returns exactly 3 user profiles — one per user", () => {
    const plan = buildSeedPlan();
    expect(plan.userProfiles).toHaveLength(3);
    const userIds = new Set(plan.users.map((u) => u.id));
    for (const profile of plan.userProfiles) {
      expect(userIds.has(profile.userId)).toBe(true);
      expect(typeof profile.displayName).toBe("string");
      expect(profile.displayName!.length).toBeGreaterThan(0);
    }
  });

  it("user profiles are scoped to the tenant", () => {
    const plan = buildSeedPlan();
    const tenantId = plan.tenants[0]!.id;
    for (const profile of plan.userProfiles) {
      expect(profile.tenantId).toBe(tenantId);
    }
  });

  it("is deterministic — running twice produces equal output", () => {
    expect(buildSeedPlan()).toEqual(buildSeedPlan());
  });

  it("ids are time-ordered UUIDs (v7-shaped) and all unique", () => {
    const plan = buildSeedPlan();
    const allIds = [
      ...plan.tenants.map((t) => t.id),
      ...plan.roles.map((r) => r.id),
      ...plan.policies.map((p) => p.id),
      ...plan.permissions.map((p) => p.id),
      ...plan.users.map((u) => u.id),
      ...plan.userProfiles.map((p) => p.id),
      ...plan.tenantMembers.map((m) => m.id),
    ];
    for (const id of allIds) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("supports a custom `now` so tests get reproducible timestamps", () => {
    const plan = buildSeedPlan({ now: new Date("2026-01-01T00:00:00Z") });
    for (const tenant of plan.tenants) {
      expect(tenant.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    }
    for (const user of plan.users) {
      expect(user.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    }
  });
});
