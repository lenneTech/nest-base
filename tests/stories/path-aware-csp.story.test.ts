import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Story · path-aware CSP for JSON API responses (CF.SEC.05 — Finding
 * 11 from iter-84 reviewer).
 *
 * The PRD pins "path-aware CSP (no unsafe-inline on JSON APIs)". Iter-15
 * registered Helmet with one CSP per env regardless of route, which
 * leaves dev-mode JSON responses carrying `script-src 'unsafe-inline'
 * 'unsafe-eval'`. Iter-89 adds a path-aware override so JSON responses
 * always emit the strict PROD-shape CSP — the lenient DEV CSP only
 * applies to HTML routes (e.g. `/admin/*` Scalar / dev hub).
 *
 * Tests run against a development bootstrap (NODE_ENV=development) so
 * the dev CSP is the baseline. Production CSP is already strict on
 * every route, so the override is a no-op.
 */
describe("Story · path-aware CSP (no unsafe-inline on JSON APIs)", () => {
  let app: INestApplication;
  let previousNodeEnv: string | undefined;

  beforeAll(async () => {
    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const { bootstrap } = await import("../../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  it("JSON API response (/api/openapi.json) carries the strict CSP — no unsafe-inline", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/openapi.json")
      .set("Accept", "application/json");
    expect(res.status).toBe(200);
    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toMatch(/script-src\s+'self'/);
  });

  it("HTML dev page (/admin/audit) carries the lenient DEV CSP (unsafe-inline allowed)", async () => {
    const res = await request(app.getHttpServer()).get("/api/admin/audit").set("Accept", "text/html");
    // The page may 200 or redirect (auth) but the CSP header is always
    // emitted by helmet — that's the contract under test.
    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("'unsafe-inline'");
  });

  it("explicit Accept: application/json on a non-API path also gets strict CSP", async () => {
    // Hit a /dev/*.json endpoint — these are JSON despite living
    // under the /dev/ prefix. The path-aware override keys on the
    // Accept header + the response Content-Type so JSON-shaped
    // responses always emit the strict CSP regardless of route prefix.
    const res = await request(app.getHttpServer())
      .get("/api/dev/outbox.json")
      .set("Accept", "application/json");
    if (res.status === 200 || res.status === 401 || res.status === 403) {
      const csp = res.headers["content-security-policy"];
      expect(csp).toBeDefined();
      expect(csp).not.toContain("'unsafe-inline'");
    }
  });

  it("/health/live (JSON, public) gets strict CSP", async () => {
    const res = await request(app.getHttpServer()).get("/health/live");
    expect(res.status).toBe(200);
    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).not.toContain("'unsafe-inline'");
  });
});
