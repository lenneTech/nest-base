import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { buildSecurityHeadersConfig } from "../src/core/http/security-headers.js";

/**
 * Adapted from nest-server security-headers tests.
 *
 * The server applies Helmet + CSP on every response. CSP is environment-
 * aware: production locks `default-src` to `'self'`, dev allows
 * `'unsafe-inline'` for the dev panel.
 */
describe("Security headers (Helmet + CSP)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrap({ listen: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("sets X-Content-Type-Options: nosniff", async () => {
    const response = await request(app.getHttpServer()).get("/");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options to deny clickjacking", async () => {
    const response = await request(app.getHttpServer()).get("/");
    expect(response.headers["x-frame-options"]).toBeDefined();
    expect(response.headers["x-frame-options"].toUpperCase()).toMatch(/^(DENY|SAMEORIGIN)$/);
  });

  it("sets a Content-Security-Policy header that restricts default-src", async () => {
    const response = await request(app.getHttpServer()).get("/");
    expect(response.headers["content-security-policy"]).toBeDefined();
    expect(response.headers["content-security-policy"]).toMatch(/default-src/);
  });

  it("removes the X-Powered-By header (no framework fingerprint)", async () => {
    const response = await request(app.getHttpServer()).get("/");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("sets a Referrer-Policy header (no leakage of full URL on navigation)", async () => {
    const response = await request(app.getHttpServer()).get("/");
    expect(response.headers["referrer-policy"]).toBeDefined();
  });
});

describe("buildSecurityHeadersConfig() — env-specific CSP", () => {
  it("production CSP locks default-src to self only", () => {
    const cfg = buildSecurityHeadersConfig("production");
    expect(cfg.contentSecurityPolicy.directives["default-src"]).toEqual(["'self'"]);
    expect(cfg.contentSecurityPolicy.directives["object-src"]).toEqual(["'none'"]);
    expect(cfg.contentSecurityPolicy.directives["frame-ancestors"]).toEqual(["'none'"]);
  });

  it("development CSP allows unsafe-inline for the dev panel", () => {
    const cfg = buildSecurityHeadersConfig("development");
    expect(cfg.contentSecurityPolicy.directives["script-src"]).toContain("'unsafe-inline'");
  });

  it("development CSP whitelists Scalar (jsdelivr) + Inter (rsms.me) CDNs", () => {
    const cfg = buildSecurityHeadersConfig("development");
    const scripts = cfg.contentSecurityPolicy.directives["script-src"];
    const styles = cfg.contentSecurityPolicy.directives["style-src"];
    expect(scripts).toContain("https://cdn.jsdelivr.net");
    expect(styles).toContain("https://rsms.me");
    expect(styles).toContain("https://cdn.jsdelivr.net");
  });

  it("production CSP keeps the CDNs out (assets must be self-hosted)", () => {
    const cfg = buildSecurityHeadersConfig("production");
    expect(cfg.contentSecurityPolicy.directives["script-src"]).not.toContain(
      "https://cdn.jsdelivr.net",
    );
  });

  it("production enables HSTS with includeSubDomains and a long maxAge", () => {
    const cfg = buildSecurityHeadersConfig("production");
    expect(cfg.hsts).toEqual({
      maxAge: expect.any(Number),
      includeSubDomains: true,
      preload: true,
    });
    expect(cfg.hsts!.maxAge).toBeGreaterThanOrEqual(60 * 60 * 24 * 180);
  });

  it("development disables HSTS (http://localhost is not HTTPS)", () => {
    const cfg = buildSecurityHeadersConfig("development");
    expect(cfg.hsts).toBeUndefined();
  });
});
