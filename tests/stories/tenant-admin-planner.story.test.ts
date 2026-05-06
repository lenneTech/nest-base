/**
 * Story · Tenant admin planner (issue #87).
 *
 * Pure unit tests for `filterTenants()` and the TenantAdminController
 * planner helpers. No I/O, no NestJS booting.
 *
 * Covered cases:
 *   - Empty query returns all tenants (up to limit)
 *   - Query matching name substring is included
 *   - Query matching slug substring is included
 *   - Query matching neither is excluded
 *   - Matching is case-insensitive
 *   - Limit cap is respected
 *   - softDelete flag filter: only deleted tenants
 *   - softDelete flag filter: only active tenants
 *   - buildTenantStats aggregates memberCount and softDeleted correctly
 */
import { describe, expect, it } from "vitest";

import {
  buildTenantStats,
  filterTenants,
} from "../../src/core/multi-tenancy/tenant-admin-planner.js";

const ORGS = [
  { id: "org-1", name: "Acme Corp", slug: "acme", deletedAt: null },
  { id: "org-2", name: "Beta GmbH", slug: "beta-gmbh", deletedAt: null },
  { id: "org-3", name: "Deleted Co", slug: "deleted-co", deletedAt: new Date("2026-01-01") },
  { id: "org-4", name: "Zebra AG", slug: null, deletedAt: null },
] as const;

describe("Story · tenant-admin-planner · filterTenants", () => {
  it("empty query returns all tenants", () => {
    const result = filterTenants({ query: "", orgs: ORGS });
    expect(result).toHaveLength(4);
  });

  it("query matches name substring", () => {
    const result = filterTenants({ query: "acme", orgs: ORGS });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("org-1");
  });

  it("query matches slug substring", () => {
    const result = filterTenants({ query: "beta-gmbh", orgs: ORGS });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("org-2");
  });

  it("query matching neither name nor slug excludes tenant", () => {
    const result = filterTenants({ query: "zzznomatch", orgs: ORGS });
    expect(result).toHaveLength(0);
  });

  it("matching is case-insensitive on name", () => {
    const result = filterTenants({ query: "ACME", orgs: ORGS });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("org-1");
  });

  it("matching is case-insensitive on slug", () => {
    const result = filterTenants({ query: "BETA-GMBH", orgs: ORGS });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("org-2");
  });

  it("orgs with null slug still match by name", () => {
    const result = filterTenants({ query: "Zebra", orgs: ORGS });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("org-4");
  });

  it("limit cap is respected", () => {
    const manyOrgs = Array.from({ length: 60 }, (_, i) => ({
      id: `org-${i}`,
      name: `Org ${i}`,
      slug: `org-${i}`,
      deletedAt: null,
    }));
    const result = filterTenants({ query: "", orgs: manyOrgs, limit: 50 });
    expect(result).toHaveLength(50);
  });

  it("custom limit smaller than result set is respected", () => {
    const result = filterTenants({ query: "", orgs: ORGS, limit: 2 });
    expect(result).toHaveLength(2);
  });

  it("default limit is 100", () => {
    const manyOrgs = Array.from({ length: 120 }, (_, i) => ({
      id: `org-${i}`,
      name: `Org ${i}`,
      slug: `org-${i}`,
      deletedAt: null,
    }));
    const result = filterTenants({ query: "", orgs: manyOrgs });
    expect(result).toHaveLength(100);
  });

  it("onlyActive=true filters out soft-deleted tenants", () => {
    const result = filterTenants({ query: "", orgs: ORGS, onlyActive: true });
    expect(result.every((o) => o.deletedAt === null)).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("onlyDeleted=true returns only soft-deleted tenants", () => {
    const result = filterTenants({ query: "", orgs: ORGS, onlyDeleted: true });
    expect(result.every((o) => o.deletedAt !== null)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("org-3");
  });
});

describe("Story · tenant-admin-planner · buildTenantStats", () => {
  it("returns memberCount and softDeleted=false for active org", () => {
    const stats = buildTenantStats({
      organizationId: "org-1",
      members: [
        { id: "m1", organizationId: "org-1", userId: "u1", role: "member", createdAt: new Date() },
        { id: "m2", organizationId: "org-1", userId: "u2", role: "owner", createdAt: new Date() },
      ],
      fileSizeBytes: 1024 * 1024 * 5, // 5 MB
      deletedAt: null,
      createdAt: new Date("2026-01-01"),
    });
    expect(stats.memberCount).toBe(2);
    expect(stats.userCount).toBe(2);
    expect(stats.fileSizeMb).toBeCloseTo(5, 1);
    expect(stats.softDeleted).toBe(false);
    expect(stats.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns softDeleted=true when deletedAt is set", () => {
    const stats = buildTenantStats({
      organizationId: "org-3",
      members: [],
      fileSizeBytes: 0,
      deletedAt: new Date("2026-03-01"),
      createdAt: new Date("2026-01-01"),
    });
    expect(stats.memberCount).toBe(0);
    expect(stats.softDeleted).toBe(true);
  });

  it("fileSizeMb rounds correctly for zero bytes", () => {
    const stats = buildTenantStats({
      organizationId: "org-1",
      members: [],
      fileSizeBytes: 0,
      deletedAt: null,
      createdAt: new Date(),
    });
    expect(stats.fileSizeMb).toBe(0);
  });
});
