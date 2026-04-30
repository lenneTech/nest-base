import type { INestApplication, LoggerService } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { EmailService } from "../src/core/email/email.service.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";
import { BETTER_AUTH_INSTANCE } from "../src/core/auth/better-auth.token.js";

const SILENT_LOGGER: LoggerService = {
  log() {},
  warn() {},
  error() {},
  debug() {},
  verbose() {},
};

/**
 * E2E · Better-Auth ↔ EmailService wiring.
 *
 * Boots the full app and asserts that:
 *  1. The injected Better-Auth instance carries the email-hook closures
 *     (i.e. the BetterAuthModule has actually wired `EmailService`).
 *  2. A live sign-up triggers the verification flow, which lands a
 *     templated send through `EmailService` — verified by intercepting
 *     the `EmailService` provider with a sender spy.
 */
describe("E2E · Better-Auth email-hooks", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const originalAppName = process.env.APP_NAME;
  const email = `hook-${Date.now()}@example.com`;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-minimum-aaaaaaaa";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.APP_NAME = "TestApp";
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({ where: { email } });
    } catch {
      // ignore — table may not exist
    }
    await app.close();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
    if (originalAppName === undefined) delete process.env.APP_NAME;
    else process.env.APP_NAME = originalAppName;
  });

  it("the running Better-Auth instance carries an email-verification hook", () => {
    // Truthy presence on the injected instance is the contract — the
    // closure itself is exercised in the next test by tapping the
    // EmailService provider.
    const instance = app.get(BETTER_AUTH_INSTANCE);
    expect(instance).toBeTruthy();
    if (!instance) return;
    expect(typeof instance.options.emailVerification?.sendVerificationEmail).toBe("function");
    expect(typeof instance.options.emailVerification?.afterEmailVerification).toBe("function");
    expect(typeof instance.options.emailAndPassword?.sendResetPassword).toBe("function");
  });

  it("sign-up routes the verification mail through EmailService.sendTemplate()", async () => {
    const emailService = app.get(EmailService);
    const calls: Array<{ template: string; to: string; vars?: object }> = [];
    // Patch the public method on the resolved instance — DI returns the
    // singleton so the spy survives until `app.close()`.
    const original = emailService.sendTemplate.bind(emailService);
    emailService.sendTemplate = (async (args) => {
      calls.push({ template: args.template, to: args.to, vars: args.vars });
      // Resolve to a fake driver result so Better-Auth's `await` succeeds
      // — we don't actually want to ship a mail in CI.
      return { messageId: "spy-1", driver: "spy" };
    }) as typeof emailService.sendTemplate;

    try {
      const res = await request(app.getHttpServer())
        .post("/api/auth/sign-up/email")
        .set("content-type", "application/json")
        .send({ email, password: "password-12345", name: "Hook User" });

      // Better-Auth either auto-sends on sign-up (config-dependent) or
      // requires an explicit `/send-verification-email` call. Either
      // way, the wiring is verified once we trigger an explicit send.
      if (calls.length === 0) {
        const verifyRes = await request(app.getHttpServer())
          .post("/api/auth/send-verification-email")
          .set("content-type", "application/json")
          .send({ email });
        // Better-Auth returns 200 / 202 on success, 4xx if verification is disabled
        expect([200, 201, 202, 400, 404]).toContain(verifyRes.status);
      }

      // The sign-up itself must succeed (or be a known 4xx) — never 404.
      expect(res.status).not.toBe(404);

      // At least one templated send went out. The flow either sends
      // verification on sign-up or via the explicit endpoint above.
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const verification = calls.find((c) => c.template === "email-verification");
      expect(verification, JSON.stringify(calls)).toBeDefined();
      expect(verification?.to).toBe(email);
      expect(verification?.vars).toMatchObject({
        appName: "TestApp",
        recipientName: "Hook User",
      });
    } finally {
      emailService.sendTemplate = original;
    }
  });
});
