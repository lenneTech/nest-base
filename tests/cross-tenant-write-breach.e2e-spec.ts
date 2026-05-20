import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaService } from "../src/core/prisma/prisma.service.js";
import { uuidV7 } from "../src/core/uuid/uuid-v7.js";

/**
 * E2E · Cross-tenant write breach (regression for LLM-test 2026-05-03 #20:21)
 *
 * Reproduces the exact attack:
 *   - Bob signs up; `createTenantWithMember` (PR #63) sets
 *     `User.tenantId = bobTenant`.
 *   - Alice owns `aliceTenant`; Bob has NO membership in it.
 *   - Bob calls `POST /examples` with `x-tenant-id: <aliceTenantId>`.
 *
 * Before the fix:
 *   - `TenantInterceptor.parseTenantHeader` blindly trusted the header
 *     → RLS context = aliceTenantId → row landed in Alice's tenant.
 *   - `AbilityMiddleware` short-circuited on `req.user.tenantId`
 *     (= bobTenant) → ability built for Bob's primary tenant grants
 *     `manage Example` → CASL `@Can('create', 'Example')` PERMITS
 *     because the type-only check doesn't evaluate the
 *     `tenantId == $CURRENT_TENANT` condition.
 *   - Net result: 201 Created, foreign-tenant write.
 *
 * After session-first policy (app `/api/*`):
 *   - Stray `x-tenant-id` on `/api/examples` is ignored; scope comes
 *     from `session.activeOrganizationId` (Better-Auth set-active).
 *   - Bob's write lands in his own tenant (or fails without an active
 *     org) — never in Alice's tenant via header override.
 */
describe("E2E · Cross-tenant write breach", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const stamp = Date.now();
  const bobEmail = `breach-bob-${stamp}@example.com`;
  const aliceEmail = `breach-alice-${stamp}@example.com`;
  const password = "password-12345";
  let bobTenantId = "";
  let aliceTenantId = "";

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";

    const { AppModule } = await import("../src/core/app/app.module.js");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Mirror bootstrap.ts: set the global /api/ prefix so BetterAuth
    // routes (e.g. /api/auth/sign-up/email) are reachable without
    // bootstrap(). Hub + health paths stay at root.
    app.setGlobalPrefix("api", {
      exclude: ["/", "health", "health/(.*)"],
    });
    await app.init();
    prisma = app.get(PrismaService);

    // Provision Alice's tenant directly — we don't need her to log in;
    // we only need the tenant id (so Bob can target it via header).
    const aliceOrgName = `breach-alice-tenant-${stamp}`;
    const aliceTenant = await prisma.organization.create({
      data: {
        id: uuidV7(),
        name: aliceOrgName,
        slug:
          aliceOrgName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 50) +
          "-" +
          stamp,
        createdAt: new Date(),
      },
    });
    aliceTenantId = aliceTenant.id;

    // Sign up Alice, pin her to her own tenant + ACTIVE membership.
    // Not strictly required for the breach repro (the breach is about
    // Bob targeting *Alice's tenant id*), but keeps the data-shape
    // realistic — a real Alice with a real tenant.
    const aliceAgent = request.agent(app.getHttpServer());
    const aliceSignUp = await aliceAgent
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email: aliceEmail, password, name: "Alice" });
    expect(aliceSignUp.status, JSON.stringify(aliceSignUp.body)).toBe(200);
    const aliceUser = await prisma.user.findUnique({ where: { email: aliceEmail } });
    expect(aliceUser).not.toBeNull();
    await prisma.member.create({
      data: {
        id: uuidV7(),
        userId: aliceUser!.id,
        organizationId: aliceTenant.id,
        role: "owner",
        createdAt: new Date(),
      },
    });

    // Provision Bob's tenant + ACTIVE membership for Bob (he is a
    // legit user — just NOT a member of Alice's tenant).
    const bobOrgName = `breach-bob-tenant-${stamp}`;
    const bobTenant = await prisma.organization.create({
      data: {
        id: uuidV7(),
        name: bobOrgName,
        slug:
          bobOrgName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 50) +
          "-" +
          stamp,
        createdAt: new Date(),
      },
    });
    bobTenantId = bobTenant.id;
  });

  afterAll(async () => {
    try {
      // Best-effort cleanup. Examples first (FK to tenant).
      await prisma.example.deleteMany({
        where: { tenantId: { in: [aliceTenantId, bobTenantId].filter(Boolean) } },
      });
      await prisma.member.deleteMany({
        where: { organizationId: { in: [aliceTenantId, bobTenantId].filter(Boolean) } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [aliceTenantId, bobTenantId].filter(Boolean) } },
      });
      await prisma.user.deleteMany({ where: { email: { in: [bobEmail, aliceEmail] } } });
    } catch {
      // ignore — testcontainer is tossed by global-setup anyway
    }
    await app.close();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  });

  it("Bob cannot write into Alice's tenant by sending her id in x-tenant-id on /api/*", async () => {
    // Sign up Bob — Better-Auth creates the User row.
    const agent = request.agent(app.getHttpServer());
    const signUp = await agent
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email: bobEmail, password, name: "Bob" });
    expect(signUp.status, JSON.stringify(signUp.body)).toBe(200);
    const bob = await prisma.user.findUnique({ where: { email: bobEmail } });
    expect(bob, "bob must persist after sign-up").not.toBeNull();

    // Pin Bob to his own primary tenant + ACTIVE membership. He is a
    // real, authenticated user with a real session tenant — he just
    // has NO right to act in Alice's tenant.
    await prisma.member.create({
      data: {
        id: uuidV7(),
        userId: bob!.id,
        organizationId: bobTenantId,
        role: "owner",
        createdAt: new Date(),
      },
    });

    const bobAgent = request.agent(app.getHttpServer());
    const signIn = await bobAgent
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({ email: bobEmail, password });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);

    const setActive = await bobAgent
      .post("/api/auth/organization/set-active")
      .set("content-type", "application/json")
      .send({ organizationId: bobTenantId });
    expect(setActive.status, JSON.stringify(setActive.body)).toBe(200);

    const breachAttempt = await bobAgent
      .post("/api/examples")
      .set("content-type", "application/json")
      .set("x-tenant-id", aliceTenantId)
      .send({ name: "cross-tenant breach", status: "draft" });

    // Header ignored — write succeeds in Bob's session tenant, not Alice's.
    expect(breachAttempt.status, JSON.stringify(breachAttempt.body)).toBe(201);

    // Defense in depth: even if the status code were misreported, NO
    // row may have landed in Alice's tenant. Query the DB directly
    // (RLS-bypass is fine here — we're verifying the attacker's input
    // never reached storage).
    const leaked = await prisma.example.findFirst({
      where: { tenantId: aliceTenantId, name: "cross-tenant breach" },
    });
    expect(leaked, "no row may exist in Alice's tenant").toBeNull();
  });

  it("Bob CAN write to his own tenant (positive control — the fix doesn't lock legitimate writes)", async () => {
    const bobAgent = request.agent(app.getHttpServer());
    const signIn = await bobAgent
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({ email: bobEmail, password });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);

    await bobAgent
      .post("/api/auth/organization/set-active")
      .set("content-type", "application/json")
      .send({ organizationId: bobTenantId });

    const ok = await bobAgent
      .post("/api/examples")
      .set("content-type", "application/json")
      .send({ name: "legit write", status: "draft" });

    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });
});
