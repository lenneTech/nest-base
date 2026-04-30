import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Brand-Config wiring end-to-end.
 *
 * Verifies that the central brand-config drives every advertised
 * surface — the dev-portal shell, the dev-portal `window.__BRAND__`
 * inline, the JSON endpoint the SPA fetches at runtime, and the
 * OpenAPI document title. A single brand source-of-truth check
 * ladders along all the consumers documented in issue #5.
 */
describe("Brand-Config · runtime surfaces", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "development";
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("/dev/brand.json", () => {
    it("returns the effective brand config", async () => {
      const res = await request(app.getHttpServer()).get("/dev/brand.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body.name).toBeTruthy();
      // Schema-validated colors — every consumer can rely on the shape.
      expect(res.body.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(res.body.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(res.body.surfaceColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(res.body.fromEmail).toMatch(/@/);
    });
  });

  describe("Dev-portal shell", () => {
    it("inlines the brand as window.__BRAND__", async () => {
      const res = await request(app.getHttpServer()).get("/dev");
      expect(res.status).toBe(200);
      expect(res.text).toContain("window.__BRAND__=");
      // The brand name lands in the title suffix too — the SPA reads
      // window.__BRAND__ to keep the tab title in sync after navigation.
      expect(res.text).toMatch(/<title>.* — nest-server<\/title>/);
    });

    it("emits a brand-derived :root override block", async () => {
      const res = await request(app.getHttpServer()).get("/dev");
      // The brand CSS lands AFTER the static tokens.css link, before
      // the boot-style block, so the runtime brand wins the cascade.
      expect(res.text).toContain("--accent: #c5fb45");
      expect(res.text).toContain(":root");
    });
  });

  describe("OpenAPI title", () => {
    it("uses the brand name as the document title", async () => {
      const res = await request(app.getHttpServer()).get("/api/openapi.json");
      expect(res.status).toBe(200);
      expect(res.body.info?.title).toBe("nest-server");
    });
  });
});
