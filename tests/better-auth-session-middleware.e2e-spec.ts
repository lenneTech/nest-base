import { Controller, Get, Req } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Can } from "../src/core/permissions/can.guard.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";

interface AuthenticatedRequest extends Request {
  user?: { id: string; tenantId: string | null };
}

@Controller("test-session")
class WhoAmIController {
  @Get("me")
  me(@Req() req: AuthenticatedRequest): { user: AuthenticatedRequest["user"] } {
    return { user: req.user };
  }

  @Get("can-restricted")
  @Can("read", "Project")
  restricted(): { status: "ok" } {
    return { status: "ok" };
  }
}

/**
 * Closes finding #3: there is now middleware that resolves a
 * Better-Auth session from the request cookies / headers, looks up
 * the matching Prisma user, and assigns `req.user`. Three properties
 * are pinned:
 *   1. Anonymous request to a public route → `req.user` undefined.
 *   2. Authenticated request → `req.user.id` matches the signed-up
 *      user.
 *   3. The pre-existing `@Can(...)` flow now denies anonymous (no
 *      ability) with 403, but with a session and a matching policy
 *      the request would pass.
 */
describe("Better-Auth · Session middleware (req.user)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const email = `session-${Date.now()}@example.com`;
  const password = "password-12345";

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-minimum-aaaaaaaa";
    process.env.APP_BASE_URL = "http://localhost:3000";
    // Build a slim test module that pulls the full AppModule (so the
    // session middleware is wired globally) and adds the WhoAmI
    // controller as a probe surface.
    const { AppModule } = await import("../src/core/app/app.module.js");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [WhoAmIController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Mirror bootstrap.ts: set the global /api/ prefix so BetterAuth
    // routes and probe controllers register under /api/... .
    app.setGlobalPrefix("api", {
      exclude: ["/", "hub/login", "hub/logout", "health", "health/(.*)"],
    });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({ where: { email } });
    } catch {
      // ignore — cleanup is best-effort
    }
    await app.close();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  });

  // The tenant interceptor still requires `x-tenant-id` on
  // non-exempt paths. Any UUID works for these probe routes — the
  // middleware doesn't read it, only the interceptor does.
  const TENANT_HEADER = "00000000-0000-7000-8000-000000000000";

  it("anonymous request to a protected route → 401 (auth required) — not 403 / not 200", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/test-session/me")
      .set("x-tenant-id", TENANT_HEADER);
    expect(res.status).toBe(401);
  });

  it("anonymous request to a public route (`/health/ready`) → req.user undefined, request passes", async () => {
    // `/health/ready` is in `isPathProtected`'s allowlist; the
    // middleware skips the lookup and lets the request through.
    const res = await request(app.getHttpServer()).get("/health/ready");
    // Either 200 (if Postgres ready) or 503 — both prove the auth
    // middleware did not 401 the public path.
    expect([200, 503]).toContain(res.status);
  });

  it("authenticated request → req.user is populated from the Better-Auth session", async () => {
    // 1. sign up. The response sets a Better-Auth cookie; supertest's
    //    agent keeps it for the next call.
    const agent = request.agent(app.getHttpServer());
    const signUp = await agent
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email, password, name: "Session User" });
    expect(signUp.status, JSON.stringify(signUp.body)).toBe(200);

    // Provision the test tenant + pin it as the user's primary so the
    // unified tenant resolver short-circuits the membership lookup
    // (header == User.tenantId → trust by `createTenantWithMember`
    // invariant). Without this the interceptor 403s an authenticated
    // request whose header points at a tenant the user has no ACTIVE
    // membership in — which is the cross-tenant write breach fix.
    await prisma.tenant.upsert({
      where: { id: TENANT_HEADER },
      update: {},
      create: { id: TENANT_HEADER, name: `session-${Date.now()}` },
    });
    const initialUser = await prisma.user.findUnique({ where: { email } });
    if (initialUser) {
      await prisma.user.update({
        where: { id: initialUser.id },
        data: { tenantId: TENANT_HEADER },
      });
    }

    // 2. probe `/test-session/me` with the same agent — the cookie
    //    rides on the request.
    const me = await agent.get("/api/test-session/me").set("x-tenant-id", TENANT_HEADER);
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    expect(me.body.user).toBeDefined();
    expect(me.body.user.id).toBeTruthy();

    // 3. The user lookup matches the persisted Prisma row.
    const persisted = await prisma.user.findUnique({ where: { email } });
    expect(persisted).not.toBeNull();
    expect(me.body.user.id).toBe(persisted!.id);
  });

  it("authenticated user without policy → @Can() denies with 403 (anonymous on the same route is 401)", async () => {
    // First confirm the anonymous case still 401s (auth-required
    // before guard).
    const anon = await request(app.getHttpServer())
      .get("/api/test-session/can-restricted")
      .set("x-tenant-id", TENANT_HEADER);
    expect(anon.status).toBe(401);

    // Now sign in with the user we created earlier and hit the
    // guarded route — no policy matches, so CASL denies with 403.
    const agent = request.agent(app.getHttpServer());
    const signIn = await agent
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({ email, password });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);

    const res = await agent.get("/api/test-session/can-restricted").set("x-tenant-id", TENANT_HEADER);
    expect(res.status).toBe(403);
  });
});
