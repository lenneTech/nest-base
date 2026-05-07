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
    // Includes core slugs the override-delete tests recreate so a
    // leftover overlay never poisons later "fetch composition for core
    // template" expectations (the runtime resolver picks module > core
    // for the same name).
    const cleanupSlugs = [
      "e2e-builder-test",
      "e2e-builder-traversal",
      "welcome",
      "password-reset",
      "email-verification",
    ];

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
      const res = await request(app.getHttpServer()).get("/hub/email-builder");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain('<div id="root"></div>');
      expect(res.text).toContain("Email Builder — nest-server");
    });

    it("GET /dev/email-builder/templates.json returns discovered templates", async () => {
      const res = await request(app.getHttpServer()).get("/hub/email-builder/templates.json");
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
      const res = await request(app.getHttpServer()).get("/hub/email-builder/blocks.json");
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
        .post("/hub/email-builder/preview.json")
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
        .post("/hub/email-builder/preview.json")
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
        .post("/hub/email-builder/save")
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
        .post("/hub/email-builder/save")
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
        .post("/hub/email-builder/save")
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
        .post("/hub/email-builder/save")
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

    // -----------------------------------------------------------------
    // Issue #49 — core-templates editable via module overlay
    // -----------------------------------------------------------------
    describe("GET /dev/email-builder/templates/:name/composition.json", () => {
      it("returns a decomposable composition for the welcome core template", async () => {
        const res = await request(app.getHttpServer()).get(
          "/hub/email-builder/templates/welcome/composition.json",
        );
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/application\/json/);
        expect(res.body.decomposable).toBe(true);
        expect(res.body.source).toBe("core");
        expect(res.body.composition).toBeDefined();
        expect(res.body.composition.layout).toBe("Barebone");
        expect(res.body.composition.children.length).toBeGreaterThan(0);
        // The raw .tsx is always returned alongside so the UI can
        // surface the source even when it's decomposable.
        expect(typeof res.body.rawSource).toBe("string");
        expect(res.body.rawSource).toContain("export default");
      });

      it("returns the password-reset and email-verification compositions", async () => {
        for (const name of ["password-reset", "email-verification"]) {
          const res = await request(app.getHttpServer()).get(
            `/hub/email-builder/templates/${name}/composition.json`,
          );
          expect(res.status).toBe(200);
          expect(res.body.decomposable).toBe(true);
          expect(res.body.composition.layout).toBe("Barebone");
        }
      });

      it("returns decomposable=false + raw source for hand-rolled templates", async () => {
        // invitation.tsx + new-device.tsx use JSX outside the composer
        // grammar — the endpoint reports it cleanly so the UI can
        // render the source view instead of opening the composer.
        for (const name of ["invitation", "new-device"]) {
          const res = await request(app.getHttpServer()).get(
            `/hub/email-builder/templates/${name}/composition.json`,
          );
          expect(res.status).toBe(200);
          expect(res.body.decomposable).toBe(false);
          expect(typeof res.body.reason).toBe("string");
          expect(typeof res.body.rawSource).toBe("string");
          expect(res.body.rawSource.length).toBeGreaterThan(0);
        }
      });

      it("returns 404 for unknown template names", async () => {
        const res = await request(app.getHttpServer()).get(
          "/hub/email-builder/templates/this-does-not-exist/composition.json",
        );
        expect(res.status).toBe(404);
      });

      it("returns 400 for invalid template name shapes", async () => {
        const res = await request(app.getHttpServer()).get(
          "/hub/email-builder/templates/..%2F..%2Fetc/composition.json",
        );
        expect([400, 404]).toContain(res.status);
      });
    });

    describe("DELETE /dev/email-builder/templates/:name/override", () => {
      const slug = "welcome";
      const overrideAbs = resolve(repoRoot, `src/modules/email/templates/${slug}.tsx`);

      beforeEach(() => {
        if (existsSync(overrideAbs)) rmSync(overrideAbs);
      });

      afterAll(() => {
        if (existsSync(overrideAbs)) rmSync(overrideAbs);
      });

      it("removes an existing module override and returns 200 acted=true", async () => {
        // First create the override via the save endpoint.
        const composition = {
          layout: "Barebone",
          subject: "Custom welcome",
          children: [{ type: "paragraph", props: { text: "Hi {{recipientName}}!" } }],
        };
        const save = await request(app.getHttpServer())
          .post("/hub/email-builder/save")
          .send({ slug, composition });
        expect(save.status).toBe(200);
        expect(existsSync(overrideAbs)).toBe(true);

        // Now delete it.
        const res = await request(app.getHttpServer()).delete(
          `/hub/email-builder/templates/${slug}/override`,
        );
        expect(res.status).toBe(200);
        expect(res.body.acted).toBe(true);
        expect(existsSync(overrideAbs)).toBe(false);
      });

      it("returns 404 when no override exists", async () => {
        const res = await request(app.getHttpServer()).delete(
          `/hub/email-builder/templates/${slug}/override`,
        );
        expect(res.status).toBe(404);
      });

      it("rejects invalid name shapes with 400", async () => {
        const res = await request(app.getHttpServer()).delete(
          "/hub/email-builder/templates/..%2Fetc/override",
        );
        expect([400, 404]).toContain(res.status);
      });

      it("never touches the core template file", async () => {
        const corePath = resolve(repoRoot, `src/core/email/templates/${slug}.tsx`);
        expect(existsSync(corePath)).toBe(true);
        await request(app.getHttpServer()).delete(
          `/hub/email-builder/templates/${slug}/override`,
        );
        expect(existsSync(corePath)).toBe(true);
      });
    });

    describe("GET /dev/email-builder/templates.json (Issue #49)", () => {
      it("flags core templates with overrides via overrideExists=true", async () => {
        const slug = "welcome";
        const overrideAbs = resolve(repoRoot, `src/modules/email/templates/${slug}.tsx`);
        if (existsSync(overrideAbs)) rmSync(overrideAbs);

        const composition = {
          layout: "Barebone",
          subject: "Custom welcome",
          children: [{ type: "paragraph", props: { text: "Hi" } }],
        };
        await request(app.getHttpServer())
          .post("/hub/email-builder/save")
          .send({ slug, composition });

        const res = await request(app.getHttpServer()).get("/hub/email-builder/templates.json");
        expect(res.status).toBe(200);
        // The list reflects discovery order. Find the *active* welcome
        // entry — module wins over core for the same name + locale.
        const welcomeEntries = res.body.templates.filter((t: { name: string }) => t.name === slug);
        // Both core and module-overlay rows are reported so the UI can
        // surface "overridden" badges.
        expect(welcomeEntries.length).toBeGreaterThanOrEqual(2);
        const moduleEntry = welcomeEntries.find((t: { source: string }) => t.source === "module");
        expect(moduleEntry).toBeDefined();
        expect(moduleEntry.overridesCore).toBe(true);
        const coreEntry = welcomeEntries.find((t: { source: string }) => t.source === "core");
        expect(coreEntry).toBeDefined();
        expect(coreEntry.overrideExists).toBe(true);

        // Cleanup
        rmSync(overrideAbs);
      });
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
      const res = await request(app.getHttpServer()).get("/hub/email-builder/templates.json");
      expect(res.status).toBe(404);
    });

    it("POST /dev/email-builder/save returns 404", async () => {
      const res = await request(app.getHttpServer())
        .post("/hub/email-builder/save")
        .send({
          slug: "anything",
          composition: { layout: "Barebone", subject: "x", children: [] },
        });
      expect(res.status).toBe(404);
    });

    it("GET /dev/email-builder/templates/:name/composition.json returns 404", async () => {
      const res = await request(app.getHttpServer()).get(
        "/hub/email-builder/templates/welcome/composition.json",
      );
      expect(res.status).toBe(404);
    });

    it("DELETE /dev/email-builder/templates/:name/override returns 404", async () => {
      const res = await request(app.getHttpServer()).delete(
        "/hub/email-builder/templates/welcome/override",
      );
      expect(res.status).toBe(404);
    });
  });
});
