import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";

import { bootstrap } from "../src/core/app/bootstrap.js";

/**
 * Adapted from nest-server `server.e2e-spec.ts` (running-app branch).
 *
 * Story: the NestJS app boots on top of Bun, exposes a metadata
 * endpoint, and shuts down cleanly. This is the smoke-test that proves
 * the project skeleton (Bun + NestJS + Prisma + Postgres) is wired.
 *
 * Issue #83: `GET /` now serves the Hub SPA shell (HTML). The API
 * identity endpoint moved to `GET /api/`.
 *
 * Health-check endpoints (`/health/live`, `/health/ready`) are a separate
 * Phase 1 slice and live in a different test file.
 */
describe("Server boot smoke", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrap({ listen: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("GET / redirects to /hub (SPA entry point)", async () => {
    const response = await request(app.getHttpServer()).get("/").expect(302);
    expect(response.headers["location"]).toBe("/hub");
  });

  it("GET /api/ returns 200 with the server metadata JSON", async () => {
    const response = await request(app.getHttpServer()).get("/api/").expect(200);

    expect(response.body).toMatchObject({
      name: expect.any(String),
      version: expect.any(String),
    });
    expect(response.body.name.length).toBeGreaterThan(0);
  });

  it("GET /api/ responds with JSON content-type", async () => {
    const response = await request(app.getHttpServer()).get("/api/");
    expect(response.headers["content-type"]).toMatch(/application\/json/);
  });

  it("GET /__missing__ returns 404 (default not-found behaviour)", async () => {
    await request(app.getHttpServer()).get("/__missing__").expect(404);
  });
});
