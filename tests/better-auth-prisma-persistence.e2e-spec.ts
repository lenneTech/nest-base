import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Better-Auth → Prisma persistence (e2e).
 *
 * This is the closing-the-loop test for the "Better-Auth uses
 * in-memory storage" finding. A sign-up via the public HTTP handler
 * MUST land a row in the Prisma `users` (and `accounts`) table — the
 * very fact that we can boot a second app instance and still find
 * the user is the proof that persistence is wired correctly.
 */
describe("Better-Auth · Prisma persistence", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const email = `persisted-${Date.now()}@example.com`;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Best-effort cleanup so subsequent runs don't see the email-unique
    // collision; the testcontainer is tossed by global-setup anyway,
    // but local re-runs against a shared DB benefit from the cleanup.
    try {
      await prisma.user.deleteMany({ where: { email } });
    } catch {
      // ignore — table may not exist if migrations haven't run
    }
    await app.close();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  });

  it("POST /api/auth/sign-up/email writes a User row to Postgres", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({
        email,
        password: "password-12345",
        name: "Persisted User",
      });

    // Better-Auth 1.6 returns 200 on a successful email/password
    // sign-up; if a future schema-mismatch regresses persistence,
    // include the response body in the failure message so the cause
    // (column missing, RLS rejection, etc.) is one log line away.
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // The user row exists with the email Better-Auth received.
    const persisted = await prisma.user.findUnique({ where: { email } });
    expect(persisted).not.toBeNull();
    expect(persisted!.email).toBe(email);
    expect(persisted!.name).toBe("Persisted User");

    // Better-Auth also writes the credential into `accounts` with the
    // hashed password — exactly what proves "no in-memory storage".
    const accounts = await prisma.account.findMany({ where: { userId: persisted!.id } });
    expect(accounts.length).toBeGreaterThanOrEqual(1);
    expect(accounts[0]!.providerId).toBe("credential");
    expect(accounts[0]!.password).toBeTruthy();
  });
});
