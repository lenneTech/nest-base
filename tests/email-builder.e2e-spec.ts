import type { INestApplication } from "@nestjs/common";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * `/dev/email-builder` controller wiring (Issue #9).
 *
 * Endpoints:
 *   - GET  /dev/email-builder                   — SPA shell
 *   - GET  /dev/email-builder/templates.json    — discovered templates + meta
 *   - GET  /dev/email-builder/blocks.json       — block library + props schema
 *   - POST /dev/email-builder/preview.json      — render composition → HTML+text
 *   - POST /dev/email-builder/save              — write composition as .tsx
 *
 * Outside `NODE_ENV=development` every endpoint 404s. Path-traversal
 * + invalid-slug attempts return 400 without touching the filesystem.
 */
describe("Dev-Hub · /dev/email-builder", () => {
  describe("in development mode", () => {
    let app: INestApplication;
    let previousNodeEnv: string | undefined;
    const repoRoot = process.cwd();
    const cleanupSlugs = ["e2e-builder-test", "e2e-builder-traversal"];

    beforeAll(async () => {
      previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    beforeEach(() => {
      // Wipe any artefacts an earlier run may have left in
      // src/modules/email/templates/ — keeps the suite hermetic.
      for (const slug of cleanupSlugs) {
        const path = resolve(repoRoot, `src/modules/email/templates/${slug}.tsx`);
        if (existsSync(path)) rmSync(path);
      }
    });

    it("GET /dev/email-builder serves the SPA shell with the correct title", async () => {
      const res = await request(app.getHttpServer()).get("/dev/email-builder");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain('<div id="root"></div>');
      expect(res.text).toContain("Email Builder — nest-server");
    });

    it("GET /dev/email-builder/templates.json returns discovered templates", async () => {
      const res = await request(app.getHttpServer()).get("/dev/email-builder/templates.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(Array.isArray(res.body.templates)).toBe(true);
      // The four core templates must be discoverable.
      const slugs: string[] = res.body.templates.map((t: { name: string }) => t.name);
      expect(slugs).toContain("email-verification");
      expect(slugs).toContain("password-reset");
      expect(slugs).toContain("welcome");
      expect(slugs).toContain("invitation");
      // Each entry exposes `source` (core/module), absolute file path,
      // and `subject` (rendered against the sample payload) so the
      // gallery can render thumbnails without a second round-trip.
      const entry = res.body.templates.find((t: { name: string }) => t.name === "password-reset");
      expect(entry.source).toBe("core");
      expect(typeof entry.file).toBe("string");
      expect(typeof entry.subject).toBe("string");
      expect(entry.subject.length).toBeGreaterThan(0);
    });

    it("GET /dev/email-builder/blocks.json returns the block library + props", async () => {
      const res = await request(app.getHttpServer()).get("/dev/email-builder/blocks.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(Array.isArray(res.body.blocks)).toBe(true);
      const types: string[] = res.body.blocks.map((b: { type: string }) => b.type);
      expect(types).toContain("greeting");
      expect(types).toContain("paragraph");
      expect(types).toContain("cta");
      expect(types).toContain("footer");
      expect(types).toContain("code");
      expect(types).toContain("divider");
      // Blocks must declare their props so the composer can render the
      // properties panel without a code change per block type.
      const cta = res.body.blocks.find((b: { type: string }) => b.type === "cta");
      expect(Array.isArray(cta.props)).toBe(true);
      expect(cta.props.find((p: { name: string }) => p.name === "href")).toBeTruthy();
      expect(Array.isArray(res.body.layouts)).toBe(true);
      expect(res.body.layouts.map((l: { name: string }) => l.name)).toContain("Barebone");
    });

    it("POST /dev/email-builder/preview.json renders a composition to HTML+text", async () => {
      const composition = {
        layout: "Barebone",
        subject: "Welcome to {{appName}}",
        preheader: "Thanks for joining",
        children: [
          { type: "greeting", props: { text: "Hello {{recipientName}}," } },
          { type: "paragraph", props: { text: "Welcome aboard." } },
          { type: "cta", props: { href: "{{ctaUrl}}", text: "Get started" } },
        ],
      };
      const res = await request(app.getHttpServer())
        .post("/dev/email-builder/preview.json")
        .send({
          composition,
          vars: {
            recipientName: "Alice",
            appName: "nest-base",
            ctaUrl: "https://example.test/start",
          },
        });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body.subject).toBe("Welcome to nest-base");
      expect(res.body.html).toContain("Hello Alice");
      expect(res.body.html).toContain("Welcome aboard");
      expect(res.body.text).toContain("Hello Alice");
    });

    it("POST /dev/email-builder/preview.json returns 400 for invalid composition", async () => {
      const res = await request(app.getHttpServer())
        .post("/dev/email-builder/preview.json")
        .send({ composition: { layout: "DoesNotExist", subject: "x", children: [] }, vars: {} });
      expect(res.status).toBe(400);
    });

    it("POST /dev/email-builder/save writes a .tsx file under src/modules/email/templates/", async () => {
      const slug = "e2e-builder-test";
      const composition = {
        layout: "Barebone",
        subject: "Hi {{recipientName}}",
        preheader: "Quick note",
        children: [
          { type: "greeting", props: { text: "Hello {{recipientName}}," } },
          { type: "paragraph", props: { text: "Just a quick check-in." } },
        ],
      };
      const res = await request(app.getHttpServer())
        .post("/dev/email-builder/save")
        .send({ slug, composition });
      expect(res.status).toBe(200);
      expect(res.body.relativePath).toBe(`src/modules/email/templates/${slug}.tsx`);
      const target = resolve(repoRoot, res.body.relativePath);
      expect(existsSync(target)).toBe(true);
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(target, "utf8");
      expect(source).toContain("AUTO-GENERATED");
      expect(source).toContain("export default function E2eBuilderTest");
      expect(source).toContain("Hello ");
      // Cleanup
      rmSync(target);
    });

    it("POST /dev/email-builder/save rejects path-traversal slugs with 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/dev/email-builder/save")
        .send({
          slug: "../../../../../../tmp/evil",
          composition: {
            layout: "Barebone",
            subject: "x",
            children: [{ type: "paragraph", props: { text: "x" } }],
          },
        });
      expect(res.status).toBe(400);
      // No file should have been written anywhere outside the templates dir.
      expect(existsSync("/tmp/evil.tsx")).toBe(false);
    });

    it("POST /dev/email-builder/save rejects invalid slug shapes with 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/dev/email-builder/save")
        .send({
          slug: "InvalidSlug",
          composition: {
            layout: "Barebone",
            subject: "x",
            children: [{ type: "paragraph", props: { text: "x" } }],
          },
        });
      expect(res.status).toBe(400);
    });

    it("POST /dev/email-builder/save rejects invalid compositions with 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/dev/email-builder/save")
        .send({
          slug: "e2e-builder-test",
          composition: {
            layout: "Unknown",
            subject: "x",
            children: [],
          },
        });
      expect(res.status).toBe(400);
    });
  });

  describe("outside development mode", () => {
    let app: INestApplication;
    let previousNodeEnv: string | undefined;

    beforeAll(async () => {
      previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    it("GET /dev/email-builder/templates.json returns 404", async () => {
      const res = await request(app.getHttpServer()).get("/dev/email-builder/templates.json");
      expect(res.status).toBe(404);
    });

    it("POST /dev/email-builder/save returns 404", async () => {
      const res = await request(app.getHttpServer())
        .post("/dev/email-builder/save")
        .send({
          slug: "anything",
          composition: { layout: "Barebone", subject: "x", children: [] },
        });
      expect(res.status).toBe(404);
    });
  });
});
