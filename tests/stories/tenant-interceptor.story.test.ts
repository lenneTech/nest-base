import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import type { ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of } from "rxjs";
import { describe, expect, it } from "vitest";

import { runWithRequestContext } from "../../src/core/request-context/request-context.js";
import {
  TenantInterceptor,
  getCurrentTenantId,
  runWithTenant,
} from "../../src/core/multi-tenancy/tenant.interceptor.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · Tenant-Interceptor + RLS-Setup
 *
 * The interceptor reads the tenant header on every request and runs the
 * handler inside a tenant-scoped AsyncLocalStorage. Domain code reads
 * the tenant via `getCurrentTenantId()` (no parameter threading), and
 * the Prisma extension that stamps `SET app.tenant_id = $1` on every
 * Postgres connection consumes the same value.
 *
 * The RLS migration enables row-level security on tenant-scoped tables
 * and installs a single policy per table that compares `tenant_id` to
 * the session-local `app.tenant_id`.
 */
describe("Story · Tenant-Interceptor + RLS", () => {
  describe("runWithTenant() / getCurrentTenantId()", () => {
    it("exposes the tenant id within the callback", async () => {
      const tenantId = "0af76519-16cd-43dd-8448-eb211c80319c";
      const result = await runWithTenant(tenantId, async () => getCurrentTenantId());
      expect(result).toBe(tenantId);
    });

    it("returns undefined outside of a tenant scope", () => {
      expect(getCurrentTenantId()).toBeUndefined();
    });

    it("isolates concurrent tenant scopes", async () => {
      const a = runWithTenant("aaaa", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getCurrentTenantId();
      });
      const b = runWithTenant("bbbb", async () => {
        await new Promise((r) => setTimeout(r, 1));
        return getCurrentTenantId();
      });
      const [aResult, bResult] = await Promise.all([a, b]);
      expect(aResult).toBe("aaaa");
      expect(bResult).toBe("bbbb");
    });
  });

  describe("TenantInterceptor", () => {
    function makeContext(
      headers: Record<string, string | string[]>,
      path = "/api/users",
    ): ExecutionContext {
      const req = { headers, originalUrl: path, url: path };
      return {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => ({}),
          getNext: () => null,
        }),
        getType: () => "http",
      } as unknown as ExecutionContext;
    }

    it("parses the tenant header and exposes it via getCurrentTenantId() during the handler", async () => {
      const tenantId = "0af76519-16cd-43dd-8448-eb211c80319c";
      const interceptor = new TenantInterceptor();
      const ctx = makeContext({ "x-tenant-id": tenantId });
      let observed: string | undefined;
      const result$ = interceptor.intercept(ctx, {
        handle: () => {
          observed = getCurrentTenantId();
          return of("ok");
        },
      });
      await lastValueFrom(await Promise.resolve(result$));
      expect(observed).toBe(tenantId);
    });

    it("skips the tenant requirement on exempt paths", async () => {
      const interceptor = new TenantInterceptor();
      const ctx = makeContext({}, "/health/live");
      let observed: string | undefined = "sentinel";
      const result$ = interceptor.intercept(ctx, {
        handle: () => {
          observed = getCurrentTenantId();
          return of("ok");
        },
      });
      await lastValueFrom(await Promise.resolve(result$));
      expect(observed).toBeUndefined();
    });

    it("rejects requests to a tenant-required path that lack the header", async () => {
      const interceptor = new TenantInterceptor();
      const ctx = makeContext({}, "/api/users");
      const result = interceptor.intercept(ctx, { handle: () => of("ok") });
      await expect(Promise.resolve(result).then((r) => lastValueFrom(r))).rejects.toThrow(
        /tenant header/i,
      );
    });

    it("rejects malformed tenant headers (non-UUID)", async () => {
      const interceptor = new TenantInterceptor();
      const ctx = makeContext({ "x-tenant-id": "not-a-uuid" }, "/api/users");
      const result = interceptor.intercept(ctx, { handle: () => of("ok") });
      await expect(Promise.resolve(result).then((r) => lastValueFrom(r))).rejects.toThrow();
    });

    // Issue #103 — session.activeOrganizationId fallback
    it("resolves the tenant from session.activeOrganizationId when no header is present (issue #103)", async () => {
      // Authenticated request with an active organization in the session but
      // without an x-tenant-id header: the interceptor must use the session's
      // activeOrganizationId as the tenant id. This allows clients that invoke
      // POST /api/auth/organization/set-active once to omit the header on
      // subsequent requests.
      const tenantId = "0af76519-16cd-43dd-8448-eb211c80319c";
      const fakePrisma = {
        tenantMember: {
          findFirst: async () => null,
        },
      };
      // The unauthenticated code-path only uses parseTenantHeader and
      // never calls `resolveRequestTenantId`, so we test the authenticated
      // path by passing a user + prisma stub. `TenantInterceptor` uses
      // `resolveRequestTenantId` for auth'd requests, which now reads
      // `req.user.activeOrganizationId` when no header is present.
      const interceptor = new TenantInterceptor(fakePrisma as never);
      const req = {
        headers: {},
        originalUrl: "/api/users",
        url: "/api/users",
        user: { id: "u1", tenantId: null, activeOrganizationId: tenantId },
      };
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => ({}),
          getNext: () => null,
        }),
        getType: () => "http",
      } as unknown as import("@nestjs/common").ExecutionContext;
      let observed: string | undefined;
      const result$ = interceptor.intercept(ctx, {
        handle: () => {
          observed = getCurrentTenantId();
          return of("ok");
        },
      });
      await lastValueFrom(await Promise.resolve(result$));
      expect(observed).toBe(tenantId);
    });

    it("integrates with request-context — tenant is visible alongside requestId/traceId", async () => {
      const tenantId = "0af76519-16cd-43dd-8448-eb211c80319c";
      const interceptor = new TenantInterceptor();
      const ctx = makeContext({ "x-tenant-id": tenantId });
      let observed: { tenant?: string; requestId?: string } = {};
      await runWithRequestContext(
        { requestId: "req-1", traceId: "t1", parentId: "p1", sampled: true },
        async () => {
          const result$ = interceptor.intercept(ctx, {
            handle: () => {
              observed = { tenant: getCurrentTenantId(), requestId: "req-1" };
              return of("ok");
            },
          });
          await lastValueFrom(await Promise.resolve(result$));
        },
      );
      expect(observed).toEqual({ tenant: tenantId, requestId: "req-1" });
    });
  });

  describe("RLS-setup migration", () => {
    const MIGRATIONS = resolve(ROOT, "prisma/migrations");

    it("a migration directory exists for the RLS setup", () => {
      const dirs = existsSync(MIGRATIONS) ? readdirSync(MIGRATIONS) : [];
      const setup = dirs.find((d) => /rls/i.test(d));
      expect(setup, `no migration matching /rls/ in prisma/migrations`).toBeDefined();
    });

    it("the migration enables RLS on the tenant-scoped tables", () => {
      const dirs = readdirSync(MIGRATIONS).filter((d) => /rls/i.test(d));
      const sql = readFileSync(resolve(MIGRATIONS, dirs[0]!, "migration.sql"), "utf8");
      expect(sql).toMatch(/ALTER\s+TABLE\s+users\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
      expect(sql).toMatch(/ALTER\s+TABLE\s+roles\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    });

    it("the migration installs a tenant-isolation policy that reads app.tenant_id", () => {
      const dirs = readdirSync(MIGRATIONS).filter((d) => /rls/i.test(d));
      const sql = readFileSync(resolve(MIGRATIONS, dirs[0]!, "migration.sql"), "utf8");
      expect(sql).toMatch(/CREATE\s+POLICY/i);
      expect(sql).toMatch(/current_setting\(\s*'app\.tenant_id'/i);
    });
  });
});
