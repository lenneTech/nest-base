import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isPathProtected } from "../../src/core/auth/jwt-middleware.js";
import { isTenantExempt } from "../../src/core/multi-tenancy/tenant-guard.js";
import { bootstrap } from "../../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Story · Legacy `/api-docs-json` alias.
 *
 * Older `nuxt-base-starter` workspaces hard-code
 * `http://127.0.0.1:3000/api-docs-json` in their `openapi-ts.config.ts`
 * fallback. Since this server canonicalised the OpenAPI doc at
 * `/api/openapi.json`, those workspaces 401 on `pnpm run generate-types`
 * until they upgrade. We mount `/api-docs-json` as a deprecated alias
 * that returns the exact same document plus `Deprecation` /
 * `Link: rel="successor-version"` headers, buying time until the
 * upstream fix (lenneTech/nuxt-base-starter#13) propagates.
 *
 * Tracked at https://github.com/lenneTech/nuxt-base-starter/issues/13.
 */
describe("Story · Legacy /api-docs-json alias", () => {
  describe("auth + tenant exemptions", () => {
    it("treats /api-docs-json as public (no JWT required)", () => {
      expect(isPathProtected("/api-docs-json")).toBe(false);
    });

    it("treats /api-docs-json as tenant-exempt", () => {
      expect(isTenantExempt("/api-docs-json")).toBe(true);
    });
  });

  describe("HTTP behaviour", () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app?.close();
    });

    it("returns the same OpenAPI document as /api/openapi.json", async () => {
      const canonical = await request(app.getHttpServer()).get("/api/openapi.json");
      const legacy = await request(app.getHttpServer()).get("/api-docs-json");
      expect(canonical.status).toBe(200);
      expect(legacy.status).toBe(200);
      // Compare the structural body — both endpoints serve the same
      // SwaggerModule document instance, so deep equality must hold.
      expect(legacy.body).toEqual(canonical.body);
      expect(legacy.body?.openapi).toBeDefined();
      expect(legacy.body?.paths).toBeDefined();
    });

    it("sends a Deprecation header pointing clients at the canonical URL", async () => {
      const res = await request(app.getHttpServer()).get("/api-docs-json");
      expect(res.status).toBe(200);
      // RFC 8594 — Deprecation header signals to clients (and human
      // log-readers) that the endpoint is on its way out.
      expect(res.headers.deprecation).toBeDefined();
      // RFC 8288 Link header with rel="successor-version" points at
      // /api/openapi.json. SDK generators that respect the hint can
      // self-heal without a config change.
      expect(res.headers.link).toContain("</api/openapi.json>");
      expect(res.headers.link).toContain('rel="successor-version"');
    });
  });
});
