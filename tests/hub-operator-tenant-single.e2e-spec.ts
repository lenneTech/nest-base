import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaService } from "../src/core/prisma/prisma.service.js";
import {
  createApiTestSession,
  ensureOrganizationMember,
  type ApiTestSession,
} from "./helpers/api-request.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Single-tenant Hub regression (the real BYND deployment shape).
 *
 * BYND runs `FEATURE_MULTI_TENANCY_ENABLED=false`, so the core
 * `TenantInterceptor` is NOT mounted (app.module.ts:255 gates it on
 * `features.multiTenancy.enabled`). The tenant-scoped admin JSON routes
 * (`GET /hub/admin/roles`, …) still call `requireTenantContext()` — with no
 * interceptor there is no tenant in the ALS, so they threw 400 "tenant
 * context is required" and the Roles page hung in "Loading roles…".
 *
 * The fix mounts a Hub-scoped single-tenant interceptor
 * (`HubOperatorTenantInterceptor`) that resolves the operator's OWN
 * membership tenant for `isHubPortalProtectedPath` requests. Product
 * `/api/*` paths stay pass-through (they pin their own tenant).
 *
 * Isolation invariant proven here: the fallback resolves ONLY the
 * caller's own membership — no foreign-tenant leak, no blind
 * SINGLE_TENANT_ID (a user with no membership still gets 400).
 *
 * `FEATURE_MULTI_TENANCY_ENABLED` is read at import time by
 * `loadFeatures()` in app.module.ts, so it is pinned BEFORE the dynamic
 * `import()` of `bootstrap` (a top-level static import would evaluate the
 * app-module graph before `beforeAll` runs).
 */
describe("Hub · single-tenant operator tenant resolution for admin JSON", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Per-suite unique tenants keep this spec isolated from concurrent forks
  // writing to the shared `role` / `member` / `organization` tables
  // (tests/CLAUDE.md "Shared-table isolation").
  const memberTenantId = crypto.randomUUID();
  const foreignTenantId = crypto.randomUUID();

  let memberRoleId: string;
  let foreignRoleId: string;

  // Operator with a membership in memberTenantId but NO active organization
  // (single-tenant → org plugin off → set-active does not exist).
  let operatorSession: ApiTestSession;

  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    originalEnv.FEATURE_MULTI_TENANCY_ENABLED = process.env.FEATURE_MULTI_TENANCY_ENABLED;
    originalEnv.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
    originalEnv.APP_BASE_URL = process.env.APP_BASE_URL;
    // Pin single-tenant BEFORE the app-module graph is evaluated.
    process.env.FEATURE_MULTI_TENANCY_ENABLED = "false";
    process.env.BETTER_AUTH_SECRET ??=
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL ??= "http://localhost:3000";

    const { bootstrap } = await import("../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    // Operator: member of memberTenantId, no set-active.
    operatorSession = await createApiTestSession(app.getHttpServer(), {
      email: `hub-single-${Date.now()}@example.com`,
      name: "Hub Single Tenant Operator",
    });
    await ensureOrganizationMember(prisma, {
      organizationId: memberTenantId,
      userId: operatorSession.userId,
    });
    memberRoleId = (
      await prisma.role.create({
        data: { name: `member-role-${crypto.randomUUID()}`, tenantId: memberTenantId },
      })
    ).id;

    // Foreign tenant + role the operator is NOT a member of.
    await prisma.organization.create({
      data: {
        id: foreignTenantId,
        name: `hub-foreign-${foreignTenantId}`,
        slug: `hub-foreign-${foreignTenantId}`,
        createdAt: new Date(),
      },
    });
    foreignRoleId = (
      await prisma.role.create({
        data: { name: `foreign-role-${crypto.randomUUID()}`, tenantId: foreignTenantId },
      })
    ).id;
  });

  afterAll(async () => {
    try {
      const tenants = [memberTenantId, foreignTenantId];
      await prisma.role.deleteMany({ where: { tenantId: { in: tenants } } });
      await prisma.member.deleteMany({ where: { organizationId: { in: tenants } } });
      await prisma.organization.deleteMany({ where: { id: { in: tenants } } });
    } catch {
      // best-effort cleanup
    }
    await app?.close();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("GET /hub/admin/roles resolves the operator's membership tenant (was 400)", async () => {
    const res = await operatorSession.agent.get("/hub/admin/roles").set("x-test-ability", "full");
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(memberRoleId);
  });

  it("does NOT leak a foreign tenant's roles through the membership fallback", async () => {
    const res = await operatorSession.agent.get("/hub/admin/roles").set("x-test-ability", "full");
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(foreignRoleId);
  });

  it("still 4xx for an authenticated user with no membership at all (no blind fallback)", async () => {
    // With the interceptor now passing through when no tenant is
    // resolvable, this 400 is raised by the handler's
    // `requireTenantContext()` (a tenant-REQUIRED route), NOT by the
    // interceptor — the membership-less contract is preserved either way.
    const stranger = await createApiTestSession(app.getHttpServer(), {
      email: `hub-single-no-membership-${Date.now()}@example.com`,
      name: "Hub Single No Membership",
    });
    const res = await stranger.agent.get("/hub/admin/roles").set("x-test-ability", "full");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/tenant/i);
  });

  it("does NOT 400 a @Public tenant-OPTIONAL hub probe for a membership-less operator", async () => {
    // Regression guard for the interceptor pass-through: `/hub/portal-access.json`
    // is @Public and matched by `isHubPortalProtectedPath`, but it decides hub
    // access and MUST answer WITHOUT a tenant. A membership-less operator gets a
    // snapshot (hub=false), never a 400 — proving pass-through does not break
    // tenant-optional probes the way the old fail-closed throw did.
    const stranger = await createApiTestSession(app.getHttpServer(), {
      email: `hub-single-probe-${Date.now()}@example.com`,
      name: "Hub Single Probe",
    });
    const res = await stranger.agent.get("/hub/portal-access.json");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hub: expect.any(Boolean), tenantAdmin: expect.any(Boolean) });
  });
});
