import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { hubReq } from "./helpers/hub-request.js";

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
    let previousNodeEnv: string | undefined;

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

    it("returns an HTML response", async () => {
      const res = await hubReq(app).get("/hub");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
    });

    it('serves the SPA shell with a "Dev Portal" title', async () => {
      const res = await hubReq(app).get("/hub");
      // The shell renders one HTML5 document with a fixed title and a
      // <div id="root"> mount point — the React bundle hydrates the
      // rest at runtime. Title uses "Hub" as default (issue #83 rename).
      expect(res.text).toContain('<div id="root"></div>');
    });

    it("loads the bundled SPA script as type=module from /hub/static/main.js", async () => {
      const res = await hubReq(app).get("/hub");
      expect(res.text).toMatch(
        /<script\s+type="module"\s+src="\/hub\/static\/main\.js"><\/script>/,
      );
    });

    it("escapes HTML in the rendered page (no raw user-controlled fragments)", async () => {
      const res = await hubReq(app).get("/hub");
      // Anti-injection heuristic: every <script> opening must have a
      // matching </script> close somewhere in the document.
      const opens = (res.text.match(/<script\b/g) ?? []).length;
      const closes = (res.text.match(/<\/script>/g) ?? []).length;
      expect(opens).toBe(closes);
    });

    it("GET /dev/features serves the SPA shell with the correct title", async () => {
      const res = await hubReq(app).get("/hub/features");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      // The Dev-Portal SPA shell. The page-specific DOM is rendered by
      // React on the client; the HTML response is just the loader.
      expect(res.text).toContain('<div id="root"></div>');
      expect(res.text).toContain("Features — nest-server");
    });

    it("GET /dev/feature-catalog.json returns the FEATURE_CATALOG + active Features", async () => {
      const res = await hubReq(app).get("/hub/feature-catalog.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(Array.isArray(res.body.catalog)).toBe(true);
      expect(res.body.catalog.length).toBeGreaterThan(0);
      expect(res.body.catalog.find((m: { key: string }) => m.key === "webhooks")).toBeTruthy();
      expect(res.body).toHaveProperty("features.multiTenancy");
    });

    it("GET /dev/features.json returns the active Features object as JSON", async () => {
      const res = await hubReq(app).get("/hub/features.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toHaveProperty("multiTenancy");
      expect(res.body).toHaveProperty("webhooks");
      expect(res.body).toHaveProperty("powerSync");
    });

    it("GET /dev/diagnostics renders the HTML diagnostics page", async () => {
      const res = await hubReq(app).get("/hub/diagnostics");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toMatch(/Diagnostics/);
    });

    it("GET /dev/diagnostics.json returns runtime + features report as JSON", async () => {
      const res = await hubReq(app).get("/hub/diagnostics.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toHaveProperty("runtime");
      expect(res.body).toHaveProperty("process");
      expect(res.body).toHaveProperty("features");
      expect(res.body.runtime.platform).toMatch(/darwin|linux|win32/);
    });

    it("GET /dev/routes serves the SPA shell with the correct title", async () => {
      const res = await hubReq(app).get("/hub/routes");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain('<div id="root"></div>');
      expect(res.text).toContain("Routes — nest-server");
    });

    it("GET /dev/traces renders the HTML trace viewer", async () => {
      // Make a request first so the buffer has something to show.
      await hubReq(app).get("/hub/diagnostics.json");
      const res = await hubReq(app).get("/hub/traces");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toMatch(/Traces/);
    });

    it("GET /dev/traces.json returns the structured buffer + summary", async () => {
      await hubReq(app).get("/hub/diagnostics.json");
      const res = await hubReq(app).get("/hub/traces.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(Array.isArray(res.body.traces)).toBe(true);
      expect(typeof res.body.summary.total).toBe("number");
      expect(res.body.traces.length).toBeGreaterThan(0);
      const trace = res.body.traces[res.body.traces.length - 1];
      expect(typeof trace.requestId).toBe("string");
      expect(typeof trace.durationMs).toBe("number");
      expect(typeof trace.status).toBe("number");
    });

    it("GET /dev/queries serves the SPA shell with the correct title", async () => {
      const res = await hubReq(app).get("/hub/queries");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain('<div id="root"></div>');
      expect(res.text).toContain("Queries — nest-server");
    });

    it("GET /dev/queries.json returns the structured buffer + summary + slowest + topTemplates", async () => {
      const res = await hubReq(app).get("/hub/queries.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(Array.isArray(res.body.recent)).toBe(true);
      expect(Array.isArray(res.body.slowest)).toBe(true);
      expect(Array.isArray(res.body.topTemplates)).toBe(true);
      expect(typeof res.body.summary.total).toBe("number");
      expect(typeof res.body.summary.slowestMs).toBe("number");
      expect(typeof res.body.summary.warnCount).toBe("number");
      expect(typeof res.body.summary.badCount).toBe("number");
    });

    it("GET /dev/email-preview serves the SPA shell with the correct title", async () => {
      const res = await hubReq(app).get("/hub/email-preview");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain('<div id="root"></div>');
      expect(res.text).toContain("Email Preview — nest-server");
    });

    it("GET /dev/email-preview.json returns structured catalog + rendered", async () => {
      // The React renderer reads templates from the file system. Under
      // heavy parallel-test pressure ANY template's dynamic import can
      // hit a transient race (iter-148: previously narrowed to welcome,
      // also surfaces on other templates occasionally). Retry the whole
      // request once if any template returned an error envelope, then
      // assert against the second response. The retry only kicks in
      // when the first response actually included an error field; a
      // genuinely-broken template fails on the second request too.
      const fetchPreview = async () => {
        const r = await hubReq(app).get("/hub/email-preview.json");
        expect(r.status).toBe(200);
        expect(r.headers["content-type"]).toMatch(/application\/json/);
        return r;
      };
      const hasRenderError = (rendered: Record<string, { error?: string }>): boolean =>
        Object.values(rendered).some((entry) => Boolean(entry.error));

      let res = await fetchPreview();
      expect(res.body.catalog.entries.length).toBeGreaterThanOrEqual(4);
      if (hasRenderError(res.body.rendered)) {
        res = await fetchPreview();
      }
      expect(
        res.body.rendered.welcome.subject,
        `welcome template render failed. error="${res.body.rendered.welcome.error ?? "(none)"}". rendered=${JSON.stringify(res.body.rendered)}`,
      ).toBe("Welcome to nest-base");
    });

    it("GET /dev/erd serves the SPA shell with the correct title", async () => {
      const res = await hubReq(app).get("/hub/erd");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain('<div id="root"></div>');
      expect(res.text).toContain("ERD — nest-server");
    });

    it("GET /dev/erd.json returns the parsed ERD plan", async () => {
      const res = await hubReq(app).get("/hub/erd.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(typeof res.body.mermaid).toBe("string");
      expect(res.body.mermaid).toContain("erDiagram");
      expect(typeof res.body.modelCount).toBe("number");
      expect(typeof res.body.relationCount).toBe("number");
    });

    it("GET /dev/static/main.js serves the bundled SPA entry as JavaScript", async () => {
      // Build artefact must exist for this test. `bun run build:dev-portal`
      // is part of the standard quality-gate sequence and emits the
      // file before the e2e suite runs in CI.
      const res = await hubReq(app).get("/hub/static/main.js");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/javascript/);
      // First chunk should look like JavaScript (`import`/`export`/`var`/
      // `let`/`const`/`(function` — at least one of these is always present
      // at the top of a Bun browser bundle).
      expect(res.text.length).toBeGreaterThan(100);
    });

    it("GET /dev/static/tokens.css serves the design-token CSS", async () => {
      const res = await hubReq(app).get("/hub/static/tokens.css");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/css/);
      expect(res.text).toContain("--accent: #c5fb45");
    });

    it("GET /dev/static/../package.json is rejected (no path traversal)", async () => {
      const res = await hubReq(app).get("/hub/static/..%2Fpackage.json");
      expect(res.status).toBe(404);
    });

    it("GET /dev/components renders the SPA shell (showcase route)", async () => {
      const res = await hubReq(app).get("/hub/components");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain('<div id="root"></div>');
      expect(res.text).toMatch(/<title>Components — nest-server<\/title>/);
    });

    it("GET /dev/some-future-spa-path falls through to the SPA shell", async () => {
      // The catch-all gives the client router room to add new pages
      // without a server change. Server-rendered routes still win;
      // unknown paths hand off to React.
      const res = await hubReq(app).get("/hub/this-route-only-exists-on-the-client");
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div id="root"></div>');
    });

    it("GET /dev/routes.json returns the structured inventory", async () => {
      const res = await hubReq(app).get("/hub/routes.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toHaveProperty("routes");
      expect(res.body).toHaveProperty("byController");
      expect(res.body).toHaveProperty("summary");
      expect(Array.isArray(res.body.routes)).toBe(true);
      // The route inventory stores raw controller paths (without the global
      // /api/ prefix added by bootstrap.ts). /dev is in the dev-only allowlist.
      const devRoute = res.body.routes.find(
        (r: { path: string; method: string }) => r.path === "/hub" && r.method === "GET",
      );
      expect(devRoute).toBeDefined();
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

    it("returns 404 outside development", async () => {
      const res = await request(app.getHttpServer()).get("/hub");
      expect(res.status).toBe(404);
    });

    it("returns 404 for /dev/static/* outside development", async () => {
      const res = await request(app.getHttpServer()).get("/hub/static/main.js");
      expect(res.status).toBe(404);
    });
  });
});
