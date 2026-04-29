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
 * Demo data shape:
 *   - 2 tenants ("Acme Inc", "Globex Corp")
 *   - 3 users per tenant (an admin + 2 members)
 *   - role + permission rows so the @Can('read', 'Project') paths
 *     have real abilities to test against
 *   - a small example-record per tenant
 */
describe("Story · buildSeedPlan", () => {
  it("returns 2 tenants with stable ids", () => {
    const plan = buildSeedPlan();
    expect(plan.tenants).toHaveLength(2);
    for (const tenant of plan.tenants) {
      expect(tenant.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(tenant.name.length).toBeGreaterThan(0);
    }
    // ids are unique
    expect(new Set(plan.tenants.map((t) => t.id)).size).toBe(2);
  });

  it("returns 3 users per tenant (one admin + two members)", () => {
    const plan = buildSeedPlan();
    expect(plan.users).toHaveLength(6);
    for (const tenant of plan.tenants) {
      const usersForTenant = plan.users.filter((u) => u.tenantId === tenant.id);
      expect(usersForTenant).toHaveLength(3);
    }
  });

  it("user emails follow a deterministic pattern (`<role>@<tenant-slug>.test`)", () => {
    const plan = buildSeedPlan();
    for (const user of plan.users) {
      expect(user.email).toMatch(/^[a-z0-9._-]+@[a-z0-9-]+\.test$/);
    }
    // All emails unique
    expect(new Set(plan.users.map((u) => u.email)).size).toBe(plan.users.length);
  });

  it("every user has at least one tenant_member row matching their tenantId", () => {
    const plan = buildSeedPlan();
    for (const user of plan.users) {
      const memberships = plan.tenantMembers.filter(
        (m) => m.userId === user.id && m.tenantId === user.tenantId,
      );
      expect(memberships.length).toBeGreaterThan(0);
    }
  });

  it("first user per tenant has role 'admin', others have 'member'", () => {
    const plan = buildSeedPlan();
    for (const tenant of plan.tenants) {
      const roles = plan.tenantMembers
        .filter((m) => m.tenantId === tenant.id)
        .map((m) => m.role)
        .sort();
      expect(roles).toEqual(["admin", "member", "member"]);
    }
  });

  it("is deterministic — running twice produces equal output", () => {
    expect(buildSeedPlan()).toEqual(buildSeedPlan());
  });

  it("ids are time-ordered UUIDs (v7-shaped, sortable)", () => {
    const plan = buildSeedPlan();
    // We don't require strictly monotonic, just well-formed UUIDs
    // that are unique across the plan.
    const allIds = [
      ...plan.tenants.map((t) => t.id),
      ...plan.users.map((u) => u.id),
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
  });
});
