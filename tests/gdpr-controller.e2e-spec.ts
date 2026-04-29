import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { GdprController } from "../src/core/gdpr/gdpr.controller.js";
import { CAN_METADATA_KEY } from "../src/core/permissions/can.guard.js";

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

  describe("@Can() metadata wiring (audit gate)", () => {
    // Why: /dev/routes flagged `/me/export` and `/me/account` as
    // unguarded because they had no @Can() decorator — only a
    // `req.user` nullcheck. That bypasses the CASL ability +
    // output-pipeline + permission-tester surfaces. Both handlers
    // must declare their (action, subject) so the unified perm model
    // applies.
    it("GET /me/export carries @Can('export', 'GdprData')", () => {
      const meta = Reflect.getMetadata(CAN_METADATA_KEY, GdprController.prototype.export);
      expect(meta).toEqual({ action: "export", subject: "GdprData" });
    });

    it("DELETE /me/account carries @Can('delete', 'Account')", () => {
      const meta = Reflect.getMetadata(CAN_METADATA_KEY, GdprController.prototype.deleteAccount);
      expect(meta).toEqual({ action: "delete", subject: "Account" });
    });
  });
});
