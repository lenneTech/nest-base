import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { __clearBrandCache } from "../src/core/branding/brand-loader.js";

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

  describe("POST /dev/brand", () => {
    const overlayPath = resolve(process.cwd(), "src/modules/branding/brand.json");

    afterEach(async () => {
      // Don't leave a project overlay around for the next test or for
      // the developer's own local editing — every test starts from
      // the template default.
      if (existsSync(overlayPath)) {
        await rm(overlayPath, { force: true });
      }
      __clearBrandCache();
    });

    it("rejects an invalid payload with HTTP 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/dev/brand")
        .send({ name: "", primaryColor: "not-a-color" });
      expect(res.status).toBe(400);
    });

    it("writes the overlay and returns the parsed brand", async () => {
      const res = await request(app.getHttpServer())
        .post("/dev/brand")
        .send({ name: "Acme", primaryColor: "#ff00aa" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.brand.name).toBe("Acme");
      expect(res.body.brand.primaryColor).toBe("#ff00aa");
      expect(existsSync(overlayPath)).toBe(true);
    });

    it("subsequent /dev/brand.json reads return the new value", async () => {
      await request(app.getHttpServer())
        .post("/dev/brand")
        .send({ name: "Acme", primaryColor: "#ff00aa" });
      const after = await request(app.getHttpServer()).get("/dev/brand.json");
      expect(after.body.name).toBe("Acme");
      expect(after.body.primaryColor).toBe("#ff00aa");
    });

    it("POST /dev/brand/reset removes the overlay (idempotent)", async () => {
      await request(app.getHttpServer()).post("/dev/brand").send({ name: "Acme" });
      const reset1 = await request(app.getHttpServer()).post("/dev/brand/reset");
      expect(reset1.status).toBe(200);
      expect(reset1.body.ok).toBe(true);
      expect(existsSync(overlayPath)).toBe(false);

      // Idempotent — second reset is a no-op but still HTTP 200.
      const reset2 = await request(app.getHttpServer()).post("/dev/brand/reset");
      expect(reset2.status).toBe(200);
      expect(reset2.body.ok).toBe(true);
    });
  });
});
