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
 *   1. The `organization` feature flag defaults to `true`.
 *   2. The two migration SQL files exist and are idempotent.
 *   3. The TenantInterceptor resolution order: x-tenant-id header wins
 *      over session.activeOrganizationId (explicit override beats implicit).
 *   4. The seed plan includes BA Organization + Member rows for each
 *      seeded user.
 */

describe("Story · BA Organizations Migration", () => {
  // ---------- Test 1: feature flag default ----------

  describe("Organization feature flag", () => {
    it("defaults to enabled=true when no env vars override it", () => {
      const features = loadFeatures({});
      expect(features.organization.enabled).toBe(true);
    });

    it("can be disabled via FEATURE_ORGANIZATION_ENABLED=false", () => {
      const features = loadFeatures({ FEATURE_ORGANIZATION_ENABLED: "false" });
      expect(features.organization.enabled).toBe(false);
    });

    it("can be explicitly enabled via FEATURE_ORGANIZATION_ENABLED=true", () => {
      const features = loadFeatures({ FEATURE_ORGANIZATION_ENABLED: "true" });
      expect(features.organization.enabled).toBe(true);
    });
  });

  // ---------- Test 2: migration SQL idempotency ----------

  describe("Migration SQL", () => {
    const MIGRATIONS = resolve(ROOT, "prisma/migrations");

    it("the BA organization models migration file exists", () => {
      const dirs = readdirSync(MIGRATIONS);
      const match = dirs.find((d) => d.includes("ba_organization_models"));
      expect(
        match,
        `no migration matching 'ba_organization_models' in prisma/migrations`,
      ).toBeDefined();
    });

    it("the BA organization models migration uses IF NOT EXISTS (idempotent)", () => {
      const dirs = readdirSync(MIGRATIONS);
      const match = dirs.find((d) => d.includes("ba_organization_models"));
      expect(match).toBeDefined();
      const sql = readFileSync(resolve(MIGRATIONS, match!, "migration.sql"), "utf8");
      // Every CREATE TABLE must be guarded with IF NOT EXISTS
      const createTableMatches = [...sql.matchAll(/CREATE\s+TABLE/gi)];
      const createTableIfNotExistsMatches = [
        ...sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/gi),
      ];
      expect(createTableIfNotExistsMatches.length).toBe(createTableMatches.length);
    });

    it("the BA organization models migration creates organization, member, and invitation tables", () => {
      const dirs = readdirSync(MIGRATIONS);
      const match = dirs.find((d) => d.includes("ba_organization_models"));
      expect(match).toBeDefined();
      const sql = readFileSync(resolve(MIGRATIONS, match!, "migration.sql"), "utf8");
      expect(sql).toMatch(/"organization"/);
      expect(sql).toMatch(/"member"/);
      expect(sql).toMatch(/"invitation"/);
    });

    it("the BA organization models migration adds active_organization_id to sessions", () => {
      const dirs = readdirSync(MIGRATIONS);
      const match = dirs.find((d) => d.includes("ba_organization_models"));
      expect(match).toBeDefined();
      const sql = readFileSync(resolve(MIGRATIONS, match!, "migration.sql"), "utf8");
      expect(sql).toMatch(/active_organization_id/i);
      expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
    });

    it("the tenant-to-organizations data migration file exists", () => {
      const dirs = readdirSync(MIGRATIONS);
      const match = dirs.find((d) => d.includes("migrate_tenants_to_organizations"));
      expect(
        match,
        `no migration matching 'migrate_tenants_to_organizations' in prisma/migrations`,
      ).toBeDefined();
    });

    it("the data migration uses ON CONFLICT DO NOTHING (idempotent)", () => {
      const dirs = readdirSync(MIGRATIONS);
      const match = dirs.find((d) => d.includes("migrate_tenants_to_organizations"));
      expect(match).toBeDefined();
      const sql = readFileSync(resolve(MIGRATIONS, match!, "migration.sql"), "utf8");
      // Both the organization and member inserts must be idempotent
      const conflictMatches = [...sql.matchAll(/ON\s+CONFLICT\s+.*\s+DO\s+NOTHING/gi)];
      expect(conflictMatches.length).toBeGreaterThanOrEqual(2);
    });

    it("the data migration preserves tenant UUIDs by casting to TEXT", () => {
      const dirs = readdirSync(MIGRATIONS);
      const match = dirs.find((d) => d.includes("migrate_tenants_to_organizations"));
      expect(match).toBeDefined();
      const sql = readFileSync(resolve(MIGRATIONS, match!, "migration.sql"), "utf8");
      // IDs should be cast to ::text to match BA's opaque-string id convention
      expect(sql).toMatch(/id::text/i);
    });
  });

  // ---------- Test 3: TenantInterceptor resolution order ----------

  describe("TenantInterceptor resolution order", () => {
    function makeAuthenticatedContext(opts: {
      headerTenantId?: string;
      activeOrganizationId?: string;
      userTenantId?: string;
      path?: string;
    }): { ctx: ExecutionContext; fakePrisma: object } {
      const headers: Record<string, string> = {};
      if (opts.headerTenantId) {
        headers["x-tenant-id"] = opts.headerTenantId;
      }

      const user = {
        id: "00000000-0000-7000-a000-000000000001",
        tenantId: opts.userTenantId ?? null,
        activeOrganizationId: opts.activeOrganizationId ?? null,
      };

      const req = {
        headers,
        originalUrl: opts.path ?? "/api/users",
        url: opts.path ?? "/api/users",
        user,
      };

      // Fake Prisma that returns a member when the tenantId matches the header
      const fakePrisma = {
        tenantMember: {
          findFirst: async ({ where }: { where: { tenantId: string } }) => {
            // Simulate ACTIVE membership for the header tenant id
            if (where.tenantId === opts.headerTenantId) {
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

    it("x-tenant-id header wins over session.activeOrganizationId", async () => {
      const headerTenant = "00000000-0000-7000-a000-000000000010";
      const sessionTenant = "00000000-0000-7000-a000-000000000020";

      const { ctx, fakePrisma } = makeAuthenticatedContext({
        headerTenantId: headerTenant,
        activeOrganizationId: sessionTenant,
        userTenantId: headerTenant, // matches header so no DB lookup needed
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
      // The header value must win, not the session's activeOrganizationId
      expect(observed).toBe(headerTenant);
    });

    it("falls back to session.activeOrganizationId when no header is present", async () => {
      const sessionTenant = "00000000-0000-7000-a000-000000000020";

      const { ctx, fakePrisma } = makeAuthenticatedContext({
        activeOrganizationId: sessionTenant,
        userTenantId: null,
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

    it("falls back to user.tenantId when no header and no activeOrganizationId", async () => {
      const userTenant = "00000000-0000-7000-a000-000000000030";

      const { ctx, fakePrisma } = makeAuthenticatedContext({
        userTenantId: userTenant,
        activeOrganizationId: null,
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
      expect(observed).toBe(userTenant);
    });
  });

  // ---------- Test 4: seed plan includes BA org + member rows ----------

  describe("Seed plan", () => {
    it("includes BA organization rows with the same ids as tenants", () => {
      const plan = buildSeedPlan();
      expect(plan.organizations).toBeDefined();
      expect(plan.organizations.length).toBeGreaterThanOrEqual(1);
      // Every org id must match a tenant id
      for (const org of plan.organizations) {
        const matching = plan.tenants.find((t) => t.id === org.id);
        expect(matching, `org ${org.id} has no matching tenant`).toBeDefined();
        expect(org.name).toBe(matching!.name);
        expect(org.slug).toBe(matching!.slug);
      }
    });

    it("includes BA member rows for each seeded TenantMember", () => {
      const plan = buildSeedPlan();
      expect(plan.baMembers).toBeDefined();
      expect(plan.baMembers.length).toBe(plan.tenantMembers.length);
      // Every BA member must mirror the corresponding TenantMember
      for (const baMember of plan.baMembers) {
        const matching = plan.tenantMembers.find((m) => m.id === baMember.id);
        expect(matching, `baMember ${baMember.id} has no matching tenantMember`).toBeDefined();
        expect(baMember.organizationId).toBe(matching!.tenantId);
        expect(baMember.userId).toBe(matching!.userId);
        expect(baMember.role).toBe(matching!.role);
      }
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
  });
});
