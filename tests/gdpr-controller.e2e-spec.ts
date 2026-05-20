import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { GdprController } from "../src/core/gdpr/gdpr.controller.js";
import { CAN_METADATA_KEY } from "../src/core/permissions/can.guard.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

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
    const res = await request(app.getHttpServer()).get("/api/me/export");
    expect(res.status).toBe(403);
  });

  it("DELETE /me/account 403s when unauthenticated", async () => {
    const res = await request(app.getHttpServer()).delete("/api/me/account");
    expect(res.status).toBe(403);
  });

  describe("@Can() metadata wiring (audit gate)", () => {
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
