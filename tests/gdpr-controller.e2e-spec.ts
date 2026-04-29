import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT = "11111111-1111-1111-1111-111111111111";

/**
 * GDPR endpoints — `/me/export` (Art. 15) and `DELETE /me/account`
 * (Art. 17). Both require authentication; with no authenticated
 * user attached to the request the controller throws
 * `ForbiddenException`.
 */
describe("GdprController · /me/*", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /me/export 403s when unauthenticated", async () => {
    const res = await request(app.getHttpServer()).get("/me/export").set("x-tenant-id", TENANT);
    expect(res.status).toBe(403);
  });

  it("DELETE /me/account 403s when unauthenticated", async () => {
    const res = await request(app.getHttpServer()).delete("/me/account").set("x-tenant-id", TENANT);
    expect(res.status).toBe(403);
  });
});
