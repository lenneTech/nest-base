import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT = "11111111-1111-1111-1111-111111111111";

/**
 * `/admin/webhooks` — extended JSON sidecars + re-deliver POST.
 *
 * Every endpoint short-circuits to 404 outside development. The
 * re-deliver action requires a valid CSRF token issued by
 * `/admin/webhooks.json` (or `/admin/webhooks/aggregates.json`).
 */
describe("Webhook Inspector · admin endpoints", () => {
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

    it("GET /admin/webhooks.json returns deliveries + a CSRF token", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/webhooks.json")
        .set("x-tenant-id", TENANT);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.deliveries)).toBe(true);
      expect(typeof res.body.csrfToken).toBe("string");
      expect(res.body.csrfToken.length).toBeGreaterThan(20);
      expect(res.body.filter.status).toBe("ALL");
    });

    it("GET /admin/webhooks.json honours endpoint, eventType, and search filters", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/webhooks.json?endpointId=ep-demo-1&eventType=user.created&search=demo")
        .set("x-tenant-id", TENANT);
      expect(res.status).toBe(200);
      expect(res.body.filter.endpointId).toBe("ep-demo-1");
      expect(res.body.filter.eventType).toBe("user.created");
      expect(res.body.filter.search).toBe("demo");
    });

    it("GET /admin/webhooks.json returns a cursor when there are more rows", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/webhooks.json?limit=1")
        .set("x-tenant-id", TENANT);
      expect(res.status).toBe(200);
      expect(res.body.deliveries.length).toBeLessThanOrEqual(1);
      expect("nextCursor" in res.body).toBe(true);
    });

    it("GET /admin/webhooks/aggregates.json returns endpoint stats with a sparkline", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/webhooks/aggregates.json")
        .set("x-tenant-id", TENANT);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.endpoints)).toBe(true);
      // Demo seed should populate at least one endpoint.
      if (res.body.endpoints.length > 0) {
        const ep = res.body.endpoints[0];
        expect(typeof ep.endpointId).toBe("string");
        expect(typeof ep.total).toBe("number");
        expect(typeof ep.delivered).toBe("number");
        expect(typeof ep.failed).toBe("number");
        expect(Array.isArray(ep.sparkline)).toBe(true);
        expect(ep.sparkline.length).toBeGreaterThan(0);
      }
    });

    it("GET /admin/webhooks/:id.json returns a delivery detail or 404", async () => {
      const list = await request(app.getHttpServer())
        .get("/admin/webhooks.json")
        .set("x-tenant-id", TENANT);
      const first = list.body.deliveries[0];
      if (first) {
        const res = await request(app.getHttpServer())
          .get(`/admin/webhooks/${encodeURIComponent(first.id)}.json`)
          .set("x-tenant-id", TENANT);
        expect(res.status).toBe(200);
        expect(res.body.delivery.id).toBe(first.id);
        expect(typeof res.body.curl).toBe("string");
        expect(res.body.curl).toContain("curl ");
      }
      const missing = await request(app.getHttpServer())
        .get("/admin/webhooks/does-not-exist.json")
        .set("x-tenant-id", TENANT);
      expect(missing.status).toBe(404);
    });

    it("POST /admin/webhooks/:id/redeliver requires a CSRF token", async () => {
      const list = await request(app.getHttpServer())
        .get("/admin/webhooks.json")
        .set("x-tenant-id", TENANT);
      const first = list.body.deliveries[0];
      if (!first) return;
      const res = await request(app.getHttpServer())
        .post(`/admin/webhooks/${encodeURIComponent(first.id)}/redeliver`)
        .set("x-tenant-id", TENANT)
        .send({});
      expect(res.status).toBe(403);
    });

    it("POST /admin/webhooks/:id/redeliver succeeds with a valid CSRF token", async () => {
      const list = await request(app.getHttpServer())
        .get("/admin/webhooks.json")
        .set("x-tenant-id", TENANT);
      const first = list.body.deliveries[0];
      const csrf = list.body.csrfToken;
      if (!first) return;
      const res = await request(app.getHttpServer())
        .post(`/admin/webhooks/${encodeURIComponent(first.id)}/redeliver`)
        .set("x-tenant-id", TENANT)
        .send({ csrfToken: csrf });
      expect(res.status).toBe(200);
      expect(res.body.delivery.id).toBe(first.id);
      expect(res.body.delivery.attemptCount).toBeGreaterThanOrEqual(2);
    });

    it("POST /admin/webhooks/:id/redeliver rejects a tampered CSRF token", async () => {
      const list = await request(app.getHttpServer())
        .get("/admin/webhooks.json")
        .set("x-tenant-id", TENANT);
      const first = list.body.deliveries[0];
      if (!first) return;
      const res = await request(app.getHttpServer())
        .post(`/admin/webhooks/${encodeURIComponent(first.id)}/redeliver`)
        .set("x-tenant-id", TENANT)
        .send({ csrfToken: "tampered.signature" });
      expect(res.status).toBe(403);
    });

    it("POST /admin/webhooks/:id/redeliver returns 404 for unknown ids", async () => {
      const list = await request(app.getHttpServer())
        .get("/admin/webhooks.json")
        .set("x-tenant-id", TENANT);
      const csrf = list.body.csrfToken;
      const res = await request(app.getHttpServer())
        .post("/admin/webhooks/does-not-exist/redeliver")
        .set("x-tenant-id", TENANT)
        .send({ csrfToken: csrf });
      expect(res.status).toBe(404);
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

    it("GET /admin/webhooks/aggregates.json 404s in production", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/webhooks/aggregates.json")
        .set("x-tenant-id", TENANT);
      expect(res.status).toBe(404);
    });

    it("POST /admin/webhooks/:id/redeliver 404s in production", async () => {
      const res = await request(app.getHttpServer())
        .post("/admin/webhooks/some-id/redeliver")
        .set("x-tenant-id", TENANT)
        .send({});
      expect(res.status).toBe(404);
    });
  });
});
