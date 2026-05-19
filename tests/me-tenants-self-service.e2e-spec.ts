import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ProblemDetailsExceptionFilter } from "../src/core/errors/problem-details.filter.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * E2E · /me/tenants + POST /tenants self-service
 *
 * Closes the friction-log finding: a fresh signed-up user can now
 * (a) bootstrap their first tenant via `POST /tenants` and
 * (b) discover their memberships via `GET /me/tenants`.
 *
 * Both endpoints:
 *   - require an authenticated session (Better-Auth cookie),
 *   - do NOT require the `x-tenant-id` header (they live in
 *     `tenant-guard.ts`'s exempt prefixes).
 */
describe("E2E · /me/tenants + POST /tenants self-service", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const stamp = Date.now();
  const email = `me-tenants-${stamp}@example.com`;
  const password = "password-12345";
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";

    const { AppModule } = await import("../src/core/app/app.module.js");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // The Zod-OpenAPI bridge surfaces ZodError from `ApiZodBody` parsing;
    // without the global filter `ZodError` would 500 in this Test-app
    // (bootstrap.ts wires the filter for the production runtime, but
    // `Test.createTestingModule()` does not). Register it so the
    // malformed-body assertion below sees the production-shaped 400.
    app.useGlobalFilters(new ProblemDetailsExceptionFilter());
    // Mirror bootstrap.ts: set the global /api/ prefix so BetterAuth
    // routes (e.g. /api/auth/sign-up/email) are reachable without
    // bootstrap(). Hub + health paths stay at root.
    app.setGlobalPrefix("api", {
      exclude: ["/", "health", "health/(.*)"],
    });
    Object.assign(SILENT_LOGGER, {});
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      // Best-effort cleanup. Cascade on tenantId removes memberships;
      // the user is removed last.
      for (const id of createdTenantIds) {
        await prisma.member.deleteMany({ where: { organizationId: id } });
        await prisma.organization.deleteMany({ where: { id } });
      }
      await prisma.user.deleteMany({ where: { email } });
    } catch {
      // ignore — testcontainer is tossed by global-setup anyway
    }
    await app.close();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  });

  it("anonymous → GET /me/tenants is 401 (auth required, NOT a tenant-header miss)", async () => {
    const res = await request(app.getHttpServer()).get("/api/me/tenants");
    expect(res.status).toBe(401);
  });

  it("anonymous → POST /tenants is 401", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/tenants")
      .set("content-type", "application/json")
      .send({ name: "Anonymous Inc." });
    expect(res.status).toBe(401);
  });

  it("authenticated user with zero memberships → GET /me/tenants returns []", async () => {
    const agent = request.agent(app.getHttpServer());
    const signUp = await agent
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email, password, name: "Self-Service User" });
    expect(signUp.status, JSON.stringify(signUp.body)).toBe(200);

    const res = await agent.get("/api/me/tenants");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toEqual([]);
  });

  it("authenticated user → POST /tenants creates a Tenant + ACTIVE owner membership", async () => {
    const agent = request.agent(app.getHttpServer());
    const signIn = await agent
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({ email, password });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);

    const tenantName = `Acme-${stamp}`;
    const res = await agent
      .post("/api/tenants")
      .set("content-type", "application/json")
      .send({ name: tenantName });

    expect([200, 201]).toContain(res.status);
    expect(res.body.name).toBe(tenantName);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(res.body.membership).toBeDefined();
    expect(res.body.membership.role).toBe("owner");
    expect(res.body.membership.status).toBe("ACTIVE");
    createdTenantIds.push(res.body.id);

    // Verify the row landed in Postgres + the membership FKs back.
    const tenantRow = await prisma.organization.findUnique({ where: { id: res.body.id } });
    expect(tenantRow).not.toBeNull();
    const memberRow = await prisma.member.findFirst({
      where: { organizationId: res.body.id },
    });
    expect(memberRow).not.toBeNull();
    expect(memberRow!.role).toBe("owner");
    // BA member table has no status column; presence of the row implies ACTIVE.
  });

  it("authenticated user → GET /me/tenants returns the just-created tenant", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({ email, password });

    const res = await agent.get("/api/me/tenants");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const found = (res.body as Array<{ tenantName: string; role: string; status: string }>).find(
      (r) => r.tenantName === `Acme-${stamp}`,
    );
    expect(found).toBeDefined();
    expect(found!.role).toBe("owner");
    expect(found!.status).toBe("ACTIVE");
  });

  it("POST /tenants with a duplicate name → 409 Conflict", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({ email, password });

    const res = await agent
      .post("/api/tenants")
      .set("content-type", "application/json")
      .send({ name: `Acme-${stamp}` });
    expect(res.status).toBe(409);
  });

  it("POST /tenants with empty name → 400 BadRequest", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({ email, password });

    const res = await agent
      .post("/api/tenants")
      .set("content-type", "application/json")
      .send({ name: "   " });
    expect(res.status).toBe(400);
  });

  /**
   * Friction-log entry (LLM-test 2026-05-03 #3, 20:34): the route
   * accepted raw `@Body()` without Zod validation, so SDK consumers
   * saw `201: unknown` and the contract was effectively
   * non-validating — any malformed shape was either coerced into
   * `name=""` (→ 400 generic BadRequest) or, for nullish bodies,
   * could surface as a 500. The Zod-OpenAPI migration replaces
   * `@Body()` with `@Body(new ZodValidationPipe(CreateTenantSchema))`,
   * so a wrong-typed `name` raises `ZodError` → mapped to a 400 with
   * `code: CORE_VALIDATION` and a structured `errors` array. Asserts
   * BOTH the status code and the Zod-shaped body so a regression
   * that drops the pipe is caught (a generic 400 from the legacy
   * BadRequestException would NOT carry `errors[]` with a `path`).
   */
  it("POST /tenants with a wrong-typed `name` → 400 with Zod-shaped CORE_VALIDATION error", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({ email, password });

    const res = await agent
      .post("/api/tenants")
      .set("content-type", "application/json")
      // `name` MUST be a string; sending a number is the canonical
      // shape-violation Zod catches at the boundary.
      .send({ name: 12345 });

    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe("CORE_VALIDATION");
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
    // Each Zod issue must surface its `path` so SDK consumers can
    // map the failure to the offending field.
    expect(res.body.errors[0]).toHaveProperty("path");
    expect(res.body.errors[0].path).toContain("name");
  });

  /**
   * Friction-log blocker (LLM-test 2026-05-03 #4): a freshly signed-up
   * user who creates a tenant via POST /tenants must immediately be
   * able to reach @Can()-gated routes for that tenant. Before the fix
   * `User.tenantId` was never patched, so `AbilityMiddleware`
   * short-circuited to an empty ability and every route 403'd.
   */
  it("fresh sign-up → POST /tenants → POST /examples succeeds (no 403)", async () => {
    const flowEmail = `me-tenants-flow-${stamp}@example.com`;
    const agent = request.agent(app.getHttpServer());

    // Sign up a brand-new user — no prior memberships, tenantId=null.
    const signUp = await agent
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email: flowEmail, password, name: "Fresh User" });
    expect(signUp.status, JSON.stringify(signUp.body)).toBe(200);

    // Bootstrap their first tenant.
    const tenantName = `FreshAcme-${stamp}`;
    const createTenant = await agent
      .post("/api/tenants")
      .set("content-type", "application/json")
      .send({ name: tenantName });
    expect([200, 201]).toContain(createTenant.status);
    const tenantId = createTenant.body.id as string;
    createdTenantIds.push(tenantId);

    // Now hit a `@Can("create", "Example")` route. The header carries
    // the freshly-created tenant; if either fix is missing, the
    // ability resolves to empty and CanGuard returns 403.
    const createExample = await agent
      .post("/api/examples")
      .set("content-type", "application/json")
      .set("x-tenant-id", tenantId)
      .send({ name: "First example", status: "draft" });

    expect(createExample.status, JSON.stringify(createExample.body)).toBe(201);

    // Cleanup the user we created in this scenario.
    try {
      await prisma.user.deleteMany({ where: { email: flowEmail } });
    } catch {
      // ignore
    }
  });
});
