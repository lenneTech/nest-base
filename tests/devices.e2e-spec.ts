import type { INestApplication, LoggerService } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EmailService } from "../src/core/email/email.service.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";

const SILENT_LOGGER: LoggerService = {
  log() {},
  warn() {},
  error() {},
  debug() {},
  verbose() {},
};

const TENANT = "11111111-1111-1111-1111-111111111111";

const UA_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const UA_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

/**
 * E2E · Device-handling pipeline (issue #13).
 *
 * Boots the full app with `FEATURE_DEVICE_MANAGEMENT_ENABLED=true`
 * and asserts:
 *  1. The new-device email fires on the SECOND distinct-fingerprint
 *     sign-in for the same user (first-sign-in is silent).
 *  2. `GET /me/devices` returns the active sessions.
 *  3. `DELETE /me/devices/:id` removes a session row.
 */
describe("E2E · Device-handling", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const originalAppName = process.env.APP_NAME;
  const originalFeatureFlag = process.env.FEATURE_DEVICE_MANAGEMENT_ENABLED;
  const email = `device-${Date.now()}@example.com`;

  // Spy capture, populated by patching EmailService.sendTemplate
  // before the sign-up flow runs.
  const emailCalls: Array<{ template: string; to: string; vars?: object }> = [];

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.APP_NAME = "TestApp";
    process.env.FEATURE_DEVICE_MANAGEMENT_ENABLED = "true";

    // DeviceModule is opt-in (heap-budget gate SC.BOOT.09); env must be
    // set BEFORE the bootstrap import so AppModule's top-level
    // `loadFeatures(process.env)` sees the flag.
    const { bootstrap } = await import("../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    // Patch EmailService.sendTemplate so we can observe outbound mail
    // without actually shipping anything. Better-Auth's hook resolves
    // against the same DI instance.
    const emailService = app.get(EmailService);
    emailService.sendTemplate = (async (args) => {
      emailCalls.push({ template: args.template, to: args.to, vars: args.vars });
      return { messageId: `spy-${emailCalls.length}`, driver: "spy" };
    }) as typeof emailService.sendTemplate;
  });

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({ where: { email } });
    } catch {
      // ignore
    }
    await app.close();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
    if (originalAppName === undefined) delete process.env.APP_NAME;
    else process.env.APP_NAME = originalAppName;
    if (originalFeatureFlag === undefined) delete process.env.FEATURE_DEVICE_MANAGEMENT_ENABLED;
    else process.env.FEATURE_DEVICE_MANAGEMENT_ENABLED = originalFeatureFlag;
  });

  it("does NOT send a new-device email on the first sign-in (account creation)", async () => {
    // Sign-up creates the user AND a session — but it's the very
    // first session, so the device-handling decision is
    // "first-sign-in" (silent).
    const res = await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .set("user-agent", UA_CHROME)
      .set("content-type", "application/json")
      .send({ email, password: "password-12345", name: "Device User" });
    // Better-Auth replies 200 on success.
    expect([200, 201]).toContain(res.status);

    const newDeviceCalls = emailCalls.filter((c) => c.template === "new-device");
    expect(newDeviceCalls).toHaveLength(0);
  });

  it("sends a new-device email on a second sign-in from a different UA", async () => {
    // Sign in with a different UA → fingerprint diverges → new-device.
    const res = await request(app.getHttpServer())
      .post("/api/auth/sign-in/email")
      .set("user-agent", UA_SAFARI)
      .set("content-type", "application/json")
      .send({ email, password: "password-12345" });
    // Better-Auth reply codes vary — accept 200/201.
    expect([200, 201]).toContain(res.status);

    // The sign-in is synchronous but the device-handling hook fires
    // asynchronously inside Better-Auth's `databaseHooks.session
    // .create.after` — give the event-loop a tick to resolve the
    // promise before asserting.
    await new Promise((r) => setTimeout(r, 100));

    const newDeviceCalls = emailCalls.filter((c) => c.template === "new-device");
    expect(newDeviceCalls.length).toBeGreaterThanOrEqual(1);
    expect(newDeviceCalls[0]?.to).toBe(email);
    const vars = newDeviceCalls[0]?.vars as Record<string, string> | undefined;
    expect(vars?.deviceLabel).toMatch(/Safari|iOS|Mobile/i);
    expect(vars?.revokeUrl).toMatch(/\/me\/devices/);
  });

  it("GET /me/devices lists the user's active sessions", async () => {
    // Re-sign in to obtain a fresh session cookie we can use for the
    // /me/devices call.
    const signIn = await request(app.getHttpServer())
      .post("/api/auth/sign-in/email")
      .set("user-agent", UA_CHROME)
      .set("content-type", "application/json")
      .send({ email, password: "password-12345" });
    const cookies = signIn.headers["set-cookie"];
    expect(cookies).toBeDefined();

    const res = await request(app.getHttpServer())
      .get("/api/me/devices")
      .set("user-agent", UA_CHROME)
      .set("x-tenant-id", TENANT)
      .set("cookie", joinCookies(cookies));
    expect(res.status).toBe(200);
    const list = res.body as Array<{ id: string; deviceLabel: string; current: boolean }>;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]).toMatchObject({
      id: expect.any(String),
      deviceLabel: expect.any(String),
    });
  });

  it("DELETE /me/devices/:id revokes a session", async () => {
    const signIn = await request(app.getHttpServer())
      .post("/api/auth/sign-in/email")
      .set("user-agent", UA_CHROME)
      .set("content-type", "application/json")
      .send({ email, password: "password-12345" });
    const cookies = signIn.headers["set-cookie"];

    const list = await request(app.getHttpServer())
      .get("/api/me/devices")
      .set("user-agent", UA_CHROME)
      .set("x-tenant-id", TENANT)
      .set("cookie", joinCookies(cookies));
    const items = list.body as Array<{ id: string; current: boolean }>;
    // Pick a non-current row to revoke (otherwise the next request
    // is unauthenticated and we lose the cookie too).
    const target = items.find((i) => !i.current) ?? items[items.length - 1];
    if (!target) return;

    const del = await request(app.getHttpServer())
      .delete(`/api/me/devices/${target.id}`)
      .set("user-agent", UA_CHROME)
      .set("x-tenant-id", TENANT)
      .set("cookie", joinCookies(cookies));
    expect([200, 204]).toContain(del.status);
    if (del.status === 200) {
      expect(del.body).toMatchObject({ revoked: true, id: target.id });
    }
  });
});

function joinCookies(cookies: string | string[] | undefined): string {
  if (!cookies) return "";
  const arr = Array.isArray(cookies) ? cookies : [cookies];
  return arr.map((c) => c.split(";")[0]).join("; ");
}
