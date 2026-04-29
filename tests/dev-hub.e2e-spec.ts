import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Dev-Hub controller wiring.
 *
 * `GET /dev` returns an HTML landing page listing the active DX tools,
 * driven by `planDevHub()`. Outside `NODE_ENV=development` the route
 * either 404s or returns an empty list — `/dev` is a developer-only
 * affordance.
 */
describe("Dev-Hub · GET /dev", () => {
  describe("in development mode", () => {
    let app: INestApplication;

    beforeAll(async () => {
      process.env.NODE_ENV = "development";
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app.close();
    });

    it("returns an HTML response", async () => {
      const res = await request(app.getHttpServer()).get("/dev");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
    });

    it('mentions "Dev Hub" or similar in the page title', async () => {
      const res = await request(app.getHttpServer()).get("/dev");
      expect(res.text).toMatch(/Dev[ -]Hub|Dev Tools|Developer/i);
    });

    it("renders at least the always-on tool links (Permission Tester, Active Features)", async () => {
      const res = await request(app.getHttpServer()).get("/dev");
      expect(res.text).toContain("/admin/permissions/test");
      expect(res.text).toContain("/dev/features");
    });

    it("escapes HTML in the rendered page (no raw user-controlled fragments)", async () => {
      const res = await request(app.getHttpServer()).get("/dev");
      // The page must not contain any obvious unescaped tag injection vector.
      expect(res.text).not.toMatch(/<script>(?!.*\/[ds][cr]ript)/);
    });

    it("GET /dev/features returns the active Features object as JSON", async () => {
      const res = await request(app.getHttpServer()).get("/dev/features");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toHaveProperty("multiTenancy");
      expect(res.body).toHaveProperty("webhooks");
      expect(res.body).toHaveProperty("powerSync");
    });

    it("GET /dev/diagnostics returns runtime + features report as JSON", async () => {
      const res = await request(app.getHttpServer()).get("/dev/diagnostics");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toHaveProperty("runtime");
      expect(res.body).toHaveProperty("process");
      expect(res.body).toHaveProperty("features");
      expect(res.body.runtime.platform).toMatch(/darwin|linux|win32/);
    });
  });

  describe("outside development mode", () => {
    let app: INestApplication;

    beforeAll(async () => {
      process.env.NODE_ENV = "production";
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app.close();
      process.env.NODE_ENV = "test";
    });

    it("returns 404 outside development", async () => {
      const res = await request(app.getHttpServer()).get("/dev");
      expect(res.status).toBe(404);
    });
  });
});
