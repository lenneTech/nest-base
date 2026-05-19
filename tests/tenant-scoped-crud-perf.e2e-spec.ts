import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ProblemDetailsExceptionFilter } from "../src/core/errors/problem-details.filter.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";

/**
 * E2E · Tenant-scoped CRUD median latency (SC.PERF.03).
 *
 * The PRD's `SC.PERF.03` caps tenant-scoped CRUD median at 200ms.
 * The smallest tenant-scoped CRUD surface is `GET /me/tenants` —
 * it's exempted from the tenant-header guard but still authenticated
 * (Better-Auth session cookie) and fans out to a Prisma read against
 * `TenantMember` joined with `Tenant`. That covers the same hot path
 * a tenant-scoped read goes through: auth resolve → request-context
 * → tenant-guard exempt-prefix check → controller → Prisma.
 *
 * The N=20 sample size matches the cold-start spec; the first call
 * is discarded so JIT + first-route-lookup overhead don't pollute
 * the median.
 */
const TENANT_CRUD_BUDGET_MS = 200;
const SAMPLE_SIZE = 20;

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >>> 1;
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

describe("E2E · Tenant-scoped CRUD median latency (SC.PERF.03)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const stamp = Date.now();
  const email = `crud-perf-${stamp}@example.com`;
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
    app.useGlobalFilters(new ProblemDetailsExceptionFilter());
    // Mirror bootstrap.ts: set the global /api/ prefix so BetterAuth
    // routes (e.g. /api/auth/sign-up/email) are reachable without
    // bootstrap(). Hub + health paths stay at root.
    app.setGlobalPrefix("api", {
      exclude: ["/", "health", "health/(.*)"],
    });
    await app.init();
    prisma = app.get(PrismaService);

    // Sign up + create one tenant so the GET returns a non-empty list.
    // (Empty-list reads are still tenant-scoped; the filled path covers
    // the join + projection cost the empty path skips.)
    const agent = request.agent(app.getHttpServer());
    const signUp = await agent
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email, password, name: "CRUD Perf User" });
    expect(signUp.status, JSON.stringify(signUp.body)).toBe(200);

    const tenantRes = await agent
      .post("/api/tenants")
      .set("content-type", "application/json")
      .send({ name: `CrudPerf-${stamp}` });
    expect([200, 201]).toContain(tenantRes.status);
    createdTenantIds.push(tenantRes.body.id);
  });

  afterAll(async () => {
    try {
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

  it("median GET /me/tenants latency is under 200ms (SC.PERF.03)", async () => {
    const agent = request.agent(app.getHttpServer());
    const signIn = await agent
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({ email, password });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);

    // Discard the first call — its duration absorbs JIT + first-route lookup.
    await agent.get("/api/me/tenants").expect(200);

    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const start = process.hrtime.bigint();
      const res = await agent.get("/api/me/tenants");
      const end = process.hrtime.bigint();
      expect(res.status).toBe(200);
      samples.push(Number(end - start) / 1_000_000);
    }
    const med = median(samples);
    expect(
      med,
      `median was ${med.toFixed(2)}ms, samples: [${samples.map((s) => s.toFixed(1)).join(", ")}]`,
    ).toBeLessThan(TENANT_CRUD_BUDGET_MS);
  });
});
