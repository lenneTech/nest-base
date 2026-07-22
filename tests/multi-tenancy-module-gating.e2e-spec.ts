import type { INestApplication, LoggerService } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SILENT_LOGGER: LoggerService = {
  log() {},
  warn() {},
  error() {},
  debug() {},
  verbose() {},
};

/**
 * E2E · Multi-tenancy module gating (DISABLED).
 *
 * End-to-end proof for the regression fixed in `app.module.ts`: when
 * `multiTenancy` is OFF, the tenant self-service routes
 * (`GET /me/tenants`, `POST /tenants`) must NOT be registered — an
 * authenticated request gets 404, not a live 200/201.
 *
 * Before the fix `TenantSelfServiceModule` + `TenantAdminModule` were
 * imported unconditionally, so `POST /tenants` actually created a tenant
 * even with the feature disabled — inconsistent with the Hub nav planner,
 * which already hides `/hub/admin/tenants` behind the same flag.
 *
 * The deterministic flag-state matrix (ENABLED / DISABLED / default) is
 * covered without an app boot in
 * `tests/unit/multi-tenancy-module-gating.spec.ts` (introspects the
 * `@Module({ imports })` metadata). The ENABLED-path 200/201 behaviour is
 * exercised by `tests/me-tenants-self-service.e2e-spec.ts` (boots
 * default-ON). This file keeps a single DISABLED boot for the strongest
 * proof — a real HTTP 404 — while minimising added load on the parallel
 * worker pool.
 *
 * Why an AUTHENTICATED probe: the BetterAuth session middleware 401s
 * anonymous callers BEFORE NestJS route resolution, so anonymous requests
 * cannot distinguish "route absent" (404) from "route present, auth
 * required" (401). With a valid session the request reaches the routing
 * layer, where an absent route yields 404. `/me/tenants` + `/tenants` are
 * tenant-exempt + `@Public`, so the session alone suffices.
 *
 * `app.module.ts` snapshots `loadFeatures(process.env)` at module-import
 * time, so the suite resets the module registry (`vi.resetModules()`),
 * pins the feature env OFF, then dynamically imports a FRESH `AppModule`.
 */
describe("E2E · Multi-tenancy module gating — DISABLED", () => {
  let app: INestApplication;
  // PrismaService is imported dynamically (post-reset) so the DI token
  // matches the freshly re-imported module graph.
  let prisma: { user: { deleteMany: (args: unknown) => Promise<unknown> } };
  const createdEmails: string[] = [];
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const originalFlag = process.env.FEATURE_MULTI_TENANCY_ENABLED;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    // multiTenancy is default-ON, so it must be pinned OFF explicitly.
    process.env.FEATURE_MULTI_TENANCY_ENABLED = "false";

    // AppModule reads `loadFeatures(process.env)` at module top-level;
    // reset the registry so the fresh import sees the disabled flag.
    vi.resetModules();
    const { AppModule } = await import("../src/core/app/app.module.js");
    const { PrismaService } = await import("../src/core/prisma/prisma.service.js");
    const { Test } = await import("@nestjs/testing");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: SILENT_LOGGER });
    // Mirror bootstrap.ts: `/me/*` + `/tenants` get the global `/api`
    // prefix; `/hub/admin/*` + health stay at root.
    app.setGlobalPrefix("api", {
      exclude: ["/", "health", "health/(.*)", "admin", "admin/(.*)"],
    });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      if (createdEmails.length) {
        await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
      }
    } catch {
      // ignore — testcontainer is tossed by global-setup anyway
    }
    await app.close();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
    if (originalFlag === undefined) delete process.env.FEATURE_MULTI_TENANCY_ENABLED;
    else process.env.FEATURE_MULTI_TENANCY_ENABLED = originalFlag;
  });

  /** Sign up a fresh user; returns an agent with the session cookie + the email. */
  async function authedAgent(): Promise<{
    agent: ReturnType<typeof request.agent>;
    email: string;
  }> {
    const email = `mt-gating-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
    const password = "password-12345";
    const agent = request.agent(app.getHttpServer());
    const signUp = await agent
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email, password, name: "MT Gating User" });
    if (signUp.status !== 200) {
      throw new Error(`sign-up failed (${signUp.status}): ${JSON.stringify(signUp.body)}`);
    }
    return { agent, email };
  }

  it("GET /api/me/tenants is 404 for an authenticated user (route not registered)", async () => {
    const { agent, email } = await authedAgent();
    createdEmails.push(email);
    const res = await agent.get("/api/me/tenants");
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  it("POST /api/tenants is 404 for an authenticated user (route not registered)", async () => {
    const { agent, email } = await authedAgent();
    createdEmails.push(email);
    const res = await agent
      .post("/api/tenants")
      .set("content-type", "application/json")
      .send({ name: "Should Not Exist Inc." });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });
});
