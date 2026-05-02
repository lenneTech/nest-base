import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-minimum-aaaaaaaa";
    process.env.APP_BASE_URL = "http://localhost:3000";

    const { AppModule } = await import("../src/core/app/app.module.js");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    Object.assign(SILENT_LOGGER, {});
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      // Best-effort cleanup. Cascade on tenantId removes memberships;
      // the user is removed last.
      for (const id of createdTenantIds) {
        await prisma.tenantMember.deleteMany({ where: { tenantId: id } });
        await prisma.tenant.deleteMany({ where: { id } });
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
    const res = await request(app.getHttpServer()).get("/me/tenants");
    expect(res.status).toBe(401);
  });

  it("anonymous → POST /tenants is 401", async () => {
    const res = await request(app.getHttpServer())
      .post("/tenants")
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

    const res = await agent.get("/me/tenants");
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
      .post("/tenants")
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
    const tenantRow = await prisma.tenant.findUnique({ where: { id: res.body.id } });
    expect(tenantRow).not.toBeNull();
    const memberRow = await prisma.tenantMember.findFirst({
      where: { tenantId: res.body.id },
    });
    expect(memberRow).not.toBeNull();
    expect(memberRow!.role).toBe("owner");
    expect(memberRow!.status).toBe("ACTIVE");
  });

  it("authenticated user → GET /me/tenants returns the just-created tenant", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({ email, password });

    const res = await agent.get("/me/tenants");
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
      .post("/tenants")
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
      .post("/tenants")
      .set("content-type", "application/json")
      .send({ name: "   " });
    expect(res.status).toBe(400);
  });
});
