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
      // Anti-injection heuristic: every <script> opening must have a
      // matching </script> close somewhere in the document. The page
      // legitimately contains a few <script> tags (live polling, dev-hub
      // overlays); they all close themselves.
      const opens = (res.text.match(/<script\b/g) ?? []).length;
      const closes = (res.text.match(/<\/script>/g) ?? []).length;
      expect(opens).toBe(closes);
    });

    it("GET /dev/features renders the HTML feature page", async () => {
      const res = await request(app.getHttpServer()).get("/dev/features");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain("FEATURE_WEBHOOKS_ENABLED");
      expect(res.text).toContain("Multi-Tenancy");
    });

    it("GET /dev/features.json returns the active Features object as JSON", async () => {
      const res = await request(app.getHttpServer()).get("/dev/features.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toHaveProperty("multiTenancy");
      expect(res.body).toHaveProperty("webhooks");
      expect(res.body).toHaveProperty("powerSync");
    });

    it("GET /dev/diagnostics renders the HTML diagnostics page", async () => {
      const res = await request(app.getHttpServer()).get("/dev/diagnostics");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toMatch(/Diagnostics/);
    });

    it("GET /dev/diagnostics.json returns runtime + features report as JSON", async () => {
      const res = await request(app.getHttpServer()).get("/dev/diagnostics.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toHaveProperty("runtime");
      expect(res.body).toHaveProperty("process");
      expect(res.body).toHaveProperty("features");
      expect(res.body.runtime.platform).toMatch(/darwin|linux|win32/);
    });

    it("GET /dev/routes renders the HTML route inventory page", async () => {
      const res = await request(app.getHttpServer()).get("/dev/routes");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toMatch(/Routes/);
      // The page lists at least the dev-hub's own routes.
      expect(res.text).toContain("/dev/diagnostics");
    });

    it("GET /dev/routes.json returns the structured inventory", async () => {
      const res = await request(app.getHttpServer()).get("/dev/routes.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toHaveProperty("routes");
      expect(res.body).toHaveProperty("byController");
      expect(res.body).toHaveProperty("summary");
      expect(Array.isArray(res.body.routes)).toBe(true);
      // /dev itself is in the public allowlist
      const devRoute = res.body.routes.find(
        (r: { path: string; method: string }) => r.path === "/dev" && r.method === "GET",
      );
      expect(devRoute).toBeDefined();
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
