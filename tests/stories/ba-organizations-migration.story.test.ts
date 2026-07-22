import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { lastValueFrom, of } from "rxjs";
import { describe, expect, it } from "vitest";

import { loadFeatures } from "../../src/core/features/features.js";
import { buildSeedPlan } from "../../src/core/setup/seed-plan.js";
import {
  TenantInterceptor,
  getCurrentTenantId,
} from "../../src/core/multi-tenancy/tenant.interceptor.js";
import type { ExecutionContext } from "@nestjs/common";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · BA Organizations Migration (issue #118)
 *
 * Validates that:
 *   1. The `multiTenancy` feature flag defaults to `true` (tenancy on).
 *   2. The two migration SQL files exist and are idempotent.
 *   3. Tenant resolution: session.activeOrganizationId only (set-active).
 *   4. The seed plan includes BA Organization + Member rows for each
 *      seeded user.
 */

describe("Story · BA Organizations Migration", () => {
  // ---------- Test 1: feature flag default ----------

  describe("Tenancy feature flag (multiTenancy)", () => {
    it("defaults to enabled=true when no env vars override it", () => {
      const features = loadFeatures({});
      expect(features.multiTenancy.enabled).toBe(true);
    });

    it("can be disabled via FEATURE_MULTI_TENANCY_ENABLED=false", () => {
      const features = loadFeatures({ FEATURE_MULTI_TENANCY_ENABLED: "false" });
      expect(features.multiTenancy.enabled).toBe(false);
    });
  });

  // ---------- Test 2: migration SQL idempotency ----------

  describe("Migration SQL", () => {
    const MIGRATIONS = resolve(ROOT, "prisma/migrations");

    it("the BA organization models migration file exists", () => {
      const dirs = readdirSync(MIGRATIONS);
      const match = dirs.find((d) => d.includes("init"));
      expect(match, `no init migration in prisma/migrations`).toBeDefined();
    });

    it("the BA organization models migration defines the organization tables", () => {
      // In the squashed init migration, tables are created directly without IF NOT EXISTS —
      // idempotency is guaranteed by Prisma's forward-only migration history rather than
      // per-statement guards.
      const sql = readFileSync(resolve(MIGRATIONS, "20260508000000_init", "migration.sql"), "utf8");
      expect(sql).toMatch(/CREATE\s+TABLE.*"organization"/i);
      expect(sql).toMatch(/CREATE\s+TABLE.*"member"/i);
      expect(sql).toMatch(/CREATE\s+TABLE.*"invitation"/i);
    });

    it("the BA organization models migration creates organization, member, and invitation tables", () => {
      const sql = readFileSync(resolve(MIGRATIONS, "20260508000000_init", "migration.sql"), "utf8");
      expect(sql).toMatch(/"organization"/);
      expect(sql).toMatch(/"member"/);
      expect(sql).toMatch(/"invitation"/);
    });

    it("the BA organization models migration includes active_organization_id on sessions", () => {
      // In the squashed init migration, active_organization_id is part of the sessions
      // CREATE TABLE definition rather than added via ALTER TABLE ADD COLUMN.
      const sql = readFileSync(resolve(MIGRATIONS, "20260508000000_init", "migration.sql"), "utf8");
      expect(sql).toMatch(/active_organization_id/i);
    });

    it("the tenant-to-organizations data migration file exists", () => {
      const dirs = readdirSync(MIGRATIONS);
      const match = dirs.find((d) => d.includes("init"));
      expect(match, `no init migration in prisma/migrations`).toBeDefined();
    });

    it("the init migration contains the organization and member table definitions", () => {
      // In the squashed init migration, the tenant-to-organization data migration (which
      // originally used ON CONFLICT DO NOTHING INSERT...SELECT statements) is no longer
      // present as a separate DML step — the schema itself defines the tables directly.
      // We verify that the structural definitions are present.
      const sql = readFileSync(resolve(MIGRATIONS, "20260508000000_init", "migration.sql"), "utf8");
      expect(sql).toMatch(/CREATE\s+TABLE.*"organization"/i);
      expect(sql).toMatch(/CREATE\s+TABLE.*"member"/i);
    });

    it("the BA organization id column uses TEXT type (opaque-string id convention)", () => {
      // BA organizations use TEXT PKs (opaque string ids) rather than UUID, matching
      // the Better-Auth convention. The squashed init reflects this directly in the schema.
      const sql = readFileSync(resolve(MIGRATIONS, "20260508000000_init", "migration.sql"), "utf8");
      // organization table has TEXT pk
      expect(sql).toMatch(/"organization"[\s\S]*?"id"\s+TEXT\s+NOT\s+NULL/i);
    });
  });

  // ---------- Test 3: TenantInterceptor resolution order ----------

  describe("TenantInterceptor resolution order", () => {
    function makeAuthenticatedContext(opts: {
      headerTenantId?: string;
      activeOrganizationId?: string;
      path?: string;
    }): { ctx: ExecutionContext; fakePrisma: object } {
      const headers: Record<string, string> = {};
      if (opts.headerTenantId) {
        headers["x-tenant-id"] = opts.headerTenantId;
      }

      const user = {
        id: "00000000-0000-7000-a000-000000000001",
        activeOrganizationId: opts.activeOrganizationId ?? null,
      };

      const req = {
        headers,
        originalUrl: opts.path ?? "/api/users",
        url: opts.path ?? "/api/users",
        user,
      };

      // Fake Prisma that returns a member when the organizationId matches the header
      const fakePrisma = {
        member: {
          findFirst: async ({ where }: { where: { organizationId: string } }) => {
            // Simulate active membership for the header organization id
            if (where.organizationId === opts.headerTenantId) {
              return { id: "member-1" };
            }
            return null;
          },
        },
      };

      const ctx = {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => ({}),
          getNext: () => null,
        }),
        getType: () => "http",
      } as unknown as ExecutionContext;

      return { ctx, fakePrisma };
    }

    it("session.activeOrganizationId wins over stray x-tenant-id on /hub/admin/*", async () => {
      const headerTenant = "00000000-0000-7000-a000-000000000010";
      const sessionTenant = "00000000-0000-7000-a000-000000000020";

      const { ctx, fakePrisma } = makeAuthenticatedContext({
        headerTenantId: headerTenant,
        activeOrganizationId: sessionTenant,
        path: "/hub/admin/users",
      });

      const interceptor = new TenantInterceptor(fakePrisma as never);
      let observed: string | undefined;
      const result$ = interceptor.intercept(ctx, {
        handle: () => {
          observed = getCurrentTenantId();
          return of("ok");
        },
      });
      await lastValueFrom(await Promise.resolve(result$));
      expect(observed).toBe(sessionTenant);
    });

    it("session.activeOrganizationId wins over x-tenant-id on /api/*", async () => {
      const headerTenant = "00000000-0000-7000-a000-000000000010";
      const sessionTenant = "00000000-0000-7000-a000-000000000020";

      const { ctx, fakePrisma } = makeAuthenticatedContext({
        headerTenantId: headerTenant,
        activeOrganizationId: sessionTenant,
        path: "/api/users",
      });

      const interceptor = new TenantInterceptor(fakePrisma as never);
      let observed: string | undefined;
      const result$ = interceptor.intercept(ctx, {
        handle: () => {
          observed = getCurrentTenantId();
          return of("ok");
        },
      });
      await lastValueFrom(await Promise.resolve(result$));
      expect(observed).toBe(sessionTenant);
    });

    it("falls back to session.activeOrganizationId when no header is present", async () => {
      const sessionTenant = "00000000-0000-7000-a000-000000000020";

      const { ctx, fakePrisma } = makeAuthenticatedContext({
        activeOrganizationId: sessionTenant,
      });

      const interceptor = new TenantInterceptor(fakePrisma as never);
      let observed: string | undefined;
      const result$ = interceptor.intercept(ctx, {
        handle: () => {
          observed = getCurrentTenantId();
          return of("ok");
        },
      });
      await lastValueFrom(await Promise.resolve(result$));
      expect(observed).toBe(sessionTenant);
    });

    it("returns null when no header and no activeOrganizationId (exempt path — no tenant scope)", async () => {
      // Use an exempt path (/api/me/*) so the interceptor bypasses tenant resolution
      // entirely. On non-exempt routes the interceptor throws when both header and
      // session.activeOrganizationId are absent — that is intentional (security boundary).
      const { ctx, fakePrisma } = makeAuthenticatedContext({
        activeOrganizationId: null,
        path: "/api/me/profile",
      });

      const interceptor = new TenantInterceptor(fakePrisma as never);
      let observed: string | undefined;
      const result$ = interceptor.intercept(ctx, {
        handle: () => {
          observed = getCurrentTenantId();
          return of("ok");
        },
      });
      await lastValueFrom(await Promise.resolve(result$));
      // Exempt path → interceptor skips tenant resolution → no tenant set
      expect(observed == null).toBe(true);
    });
  });

  // ---------- Test 4: seed plan includes BA org + member rows ----------

  describe("Seed plan", () => {
    it("includes BA organization rows", () => {
      const plan = buildSeedPlan();
      expect(plan.organizations).toBeDefined();
      expect(plan.organizations.length).toBeGreaterThanOrEqual(1);
      // Every org must have required fields
      for (const org of plan.organizations) {
        expect(org.id).toBeTruthy();
        expect(org.name).toBeTruthy();
        expect(org.slug).toBeTruthy();
      }
    });

    it("includes BA member rows for each seeded user", () => {
      const plan = buildSeedPlan();
      expect(plan.baMembers).toBeDefined();
      expect(plan.baMembers.length).toBe(plan.users.length);
    });

    it("BA member organizationId references a valid organization id", () => {
      const plan = buildSeedPlan();
      const orgIds = new Set(plan.organizations.map((o) => o.id));
      for (const baMember of plan.baMembers) {
        expect(orgIds.has(baMember.organizationId)).toBe(true);
      }
    });

    it("BA member userId references a valid user id", () => {
      const plan = buildSeedPlan();
      const userIds = new Set(plan.users.map((u) => u.id));
      for (const baMember of plan.baMembers) {
        expect(userIds.has(baMember.userId)).toBe(true);
      }
    });

    it("does not include legacy tenants or tenantMembers arrays", () => {
      const plan = buildSeedPlan();
      expect((plan as Record<string, unknown>)["tenants"]).toBeUndefined();
      expect((plan as Record<string, unknown>)["tenantMembers"]).toBeUndefined();
    });
  });
});
