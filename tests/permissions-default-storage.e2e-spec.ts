import { Controller, Get } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Can } from "../src/core/permissions/can.guard.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";
import { setActiveOrganization } from "./helpers/tenant-session.js";

@Controller("perm-default-probe")
class ProbeController {
  @Get("members-only")
  @Can("read", "Example")
  protectedRoute(): { status: "ok" } {
    return { status: "ok" };
  }
}

/**
 * E2E · Default Prisma-backed permission storage (closes blocker).
 *
 * Friction log: a fresh signed-up user gets 403 on every `@Can()`-gated
 * route because `PERMISSION_STORAGE` is a stub. This spec drives the
 * fix end-to-end: sign-up → activate tenant membership → request
 * `@Can('read', 'Example')` → 200 (not 403).
 *
 * The membership activation here is explicit because Better-Auth's
 * sign-up doesn't currently create one (separate finding); the asser-
 * tion is that AS SOON AS a user has an `ACTIVE` `TenantMember` row
 * in the requested tenant, the synthesized "Member" rules unblock
 * project-resource routes.
 */
describe("Permissions · default Prisma storage end-to-end", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const email = `perm-default-${Date.now()}@example.com`;
  const password = "password-12345";

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    const { AppModule } = await import("../src/core/app/app.module.js");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Mirror bootstrap.ts: set the global /api/ prefix so BetterAuth
    // routes and probe controllers register under /api/... .
    app.setGlobalPrefix("api", {
      exclude: ["/", "health", "health/(.*)"],
    });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      const u = await prisma.user.findUnique({ where: { email } });
      if (u) {
        await prisma.member.deleteMany({ where: { userId: u.id } });
        await prisma.user.delete({ where: { id: u.id } });
      }
    } catch {
      // ignore — cleanup is best-effort
    }
    await app.close();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  });

  it("active tenant member can read an @Can('read', 'Example') route (was 403 before this change)", async () => {
    // 1. Provision a tenant the user will belong to. Better-Auth's
    //    sign-up doesn't auto-create a tenant — that's a separate
    //    concern. We provision one explicitly so the assertion stays
    //    focused on "ACTIVE member → unlock" rather than auth wiring.
    const orgId = crypto.randomUUID();
    const tenant = await prisma.organization.create({
      data: {
        id: orgId,
        name: `perm-default-${Date.now()}`,
        slug: `perm-default-${orgId}`,
        createdAt: new Date(),
      },
    });

    // 2. Sign up — Better-Auth creates the User row and sets a cookie.
    const agent = request.agent(app.getHttpServer());
    const signUp = await agent
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email, password, name: "Member User" });
    expect(signUp.status, JSON.stringify(signUp.body)).toBe(200);

    // 3. Pin the user to the test tenant + add an ACTIVE membership.
    //    Without the membership row a fresh user is still locked out
    //    (matches the design: "ACTIVE member → unlock"). The user
    //    update has to happen BEFORE the next sign-in so the session
    //    payload reflects `tenantId` (Better-Auth caches the session
    //    user fields at sign-in time).
    const persisted = await prisma.user.findUnique({ where: { email } });
    expect(persisted, "user must persist after sign-up").not.toBeNull();
    // Create a BA member row — presence of the row implies ACTIVE membership.
    await prisma.member.create({
      data: {
        id: crypto.randomUUID(),
        userId: persisted!.id,
        organizationId: tenant.id,
        role: "member",
        createdAt: new Date(),
      },
    });

    // 4. Sign in again on a fresh agent so the session sees the
    //    Signed in after membership creation so the session is fresh.
    const memberAgent = request.agent(app.getHttpServer());
    const signIn = await memberAgent
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({ email, password });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);

    const cookies = signIn.headers["set-cookie"] as string[] | undefined;
    const sessionCookie = cookies?.map((c) => c.split(";")[0]).join("; ") ?? "";
    await setActiveOrganization(app.getHttpServer(), sessionCookie, tenant.id);

    // 5. Hit the protected route with the member agent. The
    //    PermissionInterceptor resolves the user's ability via
    //    PrismaPermissionStorage; the synthesized "Member" rule
    //    grants `manage:Example` for the user's tenant — `manage`
    //    covers `read`, so CanGuard passes.
    const res = await memberAgent.get("/api/perm-default-probe/members-only");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ status: "ok" });

    // Cleanup the tenant we created (cascade removes member row).
    await prisma.member.deleteMany({ where: { organizationId: tenant.id } });
    await prisma.organization.delete({ where: { id: tenant.id } });
  });
});
