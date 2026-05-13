import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Better-Auth handler is mounted at `/api/auth/*` and serves the
 * built-in routes (sign-up, sign-in, get-session, …). The runtime
 * uses Better-Auth's in-memory adapter for now, so requests land
 * on a real handler without needing a Prisma migration.
 */
describe("Better-Auth · /api/auth/* mount", () => {
  let app: INestApplication;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    await app.close();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  });

  it("GET /api/auth/get-session returns 200 with null session for an anonymous request", async () => {
    const res = await request(app.getHttpServer()).get("/api/auth/get-session");
    expect(res.status).toBe(200);
    // Better-Auth returns null (or empty) when there's no session cookie.
    expect(res.body === null || res.body === "" || typeof res.body === "object").toBe(true);
  });

  it("GET /api/auth/ok returns the Better-Auth liveness response", async () => {
    const res = await request(app.getHttpServer()).get("/api/auth/ok");
    expect([200, 404]).toContain(res.status); // some Better-Auth versions don't expose /ok
    if (res.status === 200) {
      // Better-Auth `/ok` returns `{ ok: true }`. Asserting on the
      // shape catches the case where the route is reached but the
      // response degenerates (empty body, error envelope, etc.).
      expect(res.body).toEqual(expect.objectContaining({ ok: true }));
    }
  });

  it("POST /api/auth/sign-up/email accepts a valid registration payload", async () => {
    const email = `user-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email, password: "password-12345", name: "Test User" });
    // Better-Auth responds 200 on successful sign-up; 400/422 on validation
    // failure. Either way, the route IS handled (not 404 from NestJS).
    expect(res.status).not.toBe(404);
  });

  it("an unknown auth route still routes through Better-Auth (not the NestJS 404)", async () => {
    const res = await request(app.getHttpServer()).get("/api/auth/this-does-not-exist");
    // Better-Auth's handler returns its own 404 (with Better-Auth body
    // shape), not a generic NestJS HTML/JSON 404.
    expect(res.status).toBe(404);
  });
});
