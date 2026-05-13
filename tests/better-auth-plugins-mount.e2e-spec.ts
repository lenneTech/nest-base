import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Better-Auth plugins (TOTP, Passkey, Social) light up via the
 * `features.authMethods` switches and are mounted under `/api/auth/*`
 * by the Better-Auth handler. The catch-all controller routes the
 * request through `toNodeHandler(auth)` regardless of plugin — we
 * only need to verify the plugin paths are reachable (not 404 from
 * NestJS).
 */
describe("Better-Auth · plugin mount", () => {
  let app: INestApplication;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    // Plugins are on by default (twoFactor=true, passkey=true). Social
    // providers stay empty unless we set credentials, which we do here
    // for `google`.
    process.env.FEATURE_AUTH_METHODS_SOCIAL_PROVIDERS = "google";
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    await app.close();
    process.env = { ...originalEnv };
  });

  it("2FA route is registered (POST /api/auth/two-factor/enable not 404)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/two-factor/enable")
      .set("content-type", "application/json")
      .send({ password: "wrong" });
    expect(res.status).not.toBe(404);
  });

  it("Passkey route is registered (POST /api/auth/passkey/list-user-passkeys not 404)", async () => {
    // Better-Auth's passkey plugin registers routes under
    // /api/auth/passkey/*. Without a session this responds 401 — what
    // matters is that NestJS doesn't 404 the route.
    const res = await request(app.getHttpServer())
      .get("/api/auth/passkey/list-user-passkeys")
      .set("content-type", "application/json");
    expect(res.status).not.toBe(404);
  });

  it("Social provider sign-in route is registered (POST /api/auth/sign-in/social not 404)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/sign-in/social")
      .set("content-type", "application/json")
      .send({ provider: "google", callbackURL: "/" });
    expect(res.status).not.toBe(404);
  });
});
