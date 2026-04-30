import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT = "11111111-1111-1111-1111-111111111111";

/**
 * `/admin/*` SPA shell + JSON sidecars.
 *
 * Every admin page returns the Dev-Portal SPA shell (`<div id="root">`)
 * with a page-specific `<title>`; the React tree on the client fetches
 * the matching `*.json` endpoint to populate the page. Outside
 * `NODE_ENV=development` every route 404s — same gating as the Dev-Hub.
 */
const SPA_PAGES: Array<{ url: string; title: string }> = [
  { url: "/admin/permissions/test", title: "Permission Tester" },
  { url: "/admin/webhooks", title: "Webhook Inspector" },
  { url: "/admin/realtime", title: "Realtime Inspector" },
  { url: "/admin/audit", title: "Audit Browser" },
  { url: "/admin/search", title: "Search Tester" },
];

const JSON_ENDPOINTS: Array<{ url: string; assert: (body: unknown) => void }> = [
  {
    url: "/admin/permissions/test.json",
    assert: (body) => {
      const b = body as { report: unknown; submitted: { userId: string; tenantId: string } };
      expect(b.submitted).toBeDefined();
      expect(typeof b.submitted.userId).toBe("string");
      expect(typeof b.submitted.tenantId).toBe("string");
    },
  },
  {
    url: "/admin/webhooks.json",
    assert: (body) => {
      const b = body as { deliveries: unknown[]; filter?: { status?: string } };
      expect(Array.isArray(b.deliveries)).toBe(true);
      expect(b.filter?.status).toBe("ALL");
    },
  },
  {
    url: "/admin/realtime.json",
    assert: (body) => {
      const b = body as { sockets: unknown[]; events: unknown[] };
      expect(Array.isArray(b.sockets)).toBe(true);
      expect(Array.isArray(b.events)).toBe(true);
    },
  },
  {
    url: "/admin/audit.json",
    assert: (body) => {
      const b = body as { entries: unknown[]; filter: Record<string, unknown> };
      expect(Array.isArray(b.entries)).toBe(true);
      expect(typeof b.filter).toBe("object");
    },
  },
  {
    url: "/admin/search.json",
    assert: (body) => {
      const b = body as { hits: unknown[]; query?: string };
      expect(Array.isArray(b.hits)).toBe(true);
    },
  },
];

describe("Admin SPA · /admin/* shell + JSON sidecars", () => {
  describe("in development mode", () => {
    let app: INestApplication;

    beforeAll(async () => {
      process.env.NODE_ENV = "development";
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app.close();
      process.env.NODE_ENV = "test";
    });

    for (const page of SPA_PAGES) {
      it(`GET ${page.url} returns the SPA shell with <title>${page.title}</title>`, async () => {
        const res = await request(app.getHttpServer()).get(page.url).set("x-tenant-id", TENANT);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/text\/html/);
        expect(res.text).toContain('<div id="root"></div>');
        expect(res.text).toContain(`${page.title} — nest-server`);
        expect(res.text).toMatch(/<script\s+type="module"\s+src="\/dev\/static\/main\.js"/);
      });
    }

    for (const endpoint of JSON_ENDPOINTS) {
      it(`GET ${endpoint.url} returns the structured JSON read model`, async () => {
        const res = await request(app.getHttpServer()).get(endpoint.url).set("x-tenant-id", TENANT);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/application\/json/);
        endpoint.assert(res.body);
      });
    }

    it("GET /admin/permissions/test.json with userId+tenantId returns a report", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/permissions/test.json?userId=u1&tenantId=t1")
        .set("x-tenant-id", TENANT);
      expect(res.status).toBe(200);
      expect(res.body.report).toMatchObject({ userId: "u1", tenantId: "t1", byResource: {} });
    });

    it("GET /admin/webhooks.json?status=DELIVERED echoes the filter", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/webhooks.json?status=DELIVERED")
        .set("x-tenant-id", TENANT);
      expect(res.status).toBe(200);
      expect(res.body.filter.status).toBe("DELIVERED");
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

    it("GET /admin/permissions/test 404s in production", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/permissions/test")
        .set("x-tenant-id", TENANT);
      expect(res.status).toBe(404);
    });

    it("GET /admin/webhooks.json 404s in production", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/webhooks.json")
        .set("x-tenant-id", TENANT);
      expect(res.status).toBe(404);
    });
  });
});
