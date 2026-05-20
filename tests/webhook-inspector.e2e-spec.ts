import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";
import { hubReqScoped, pinHubTestAuthEnv } from "./helpers/hub-request.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT = "11111111-1111-1111-1111-111111111111";

interface WebhookFixture {
  endpointId: string;
  deliveryId: string;
  eventType: string;
}

async function seedWebhookFixture(prisma: PrismaService): Promise<WebhookFixture> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM webhook_deliveries WHERE endpoint_id IN (SELECT id FROM webhook_endpoints WHERE tenant_id = $1::uuid)`,
    TENANT,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM webhook_endpoints WHERE tenant_id = $1::uuid`,
    TENANT,
  );

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      tenantId: TENANT,
      url: "https://hooks.fixture.example/in",
      secret: "fixture-webhook-secret",
      events: ["user.signup"],
      status: "ACTIVE",
    },
  });

  const outboxId = "00000000-0000-0000-0000-00000000f101";
  await prisma.$executeRawUnsafe(
    `INSERT INTO outbox_entries (id, tenant_id, type, payload, occurred_at)
     VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb, NOW())
     ON CONFLICT (id) DO NOTHING`,
    outboxId,
    TENANT,
    "user.signup",
  );

  const inserted = (await prisma.$queryRawUnsafe(
    `INSERT INTO webhook_deliveries
       (endpoint_id, event_id, status, status_code, attempt_count, is_test, created_at, updated_at)
     VALUES
       ($1::uuid, $2, 'DELIVERED'::"WebhookDeliveryStatus", 200, 1, false, NOW(), NOW()),
       ($1::uuid, $3, 'FAILED'::"WebhookDeliveryStatus", 500, 2, false, NOW(), NOW())
     RETURNING id`,
    endpoint.id,
    outboxId,
    "fixture-event-2",
  )) as Array<{ id: string }>;

  const deliveryId = inserted[0]?.id;
  if (!deliveryId) throw new Error("failed to seed webhook delivery");

  return { endpointId: endpoint.id, deliveryId, eventType: "user.signup" };
}

/**
 * `/admin/webhooks` — JSON sidecars + re-deliver POST (real Postgres rows only).
 */
describe("Webhook Inspector · admin endpoints", () => {
  describe("in development mode", () => {
    let app: INestApplication;
    let hub: Awaited<ReturnType<typeof hubReqScoped>>;
    let prisma: PrismaService;
    let fixture: WebhookFixture;
    let previousNodeEnv: string | undefined;

    beforeAll(async () => {
      previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      process.env.FEATURE_WEBHOOKS_ENABLED = "true";
      process.env.FEATURE_JOBS_ENABLED = "true";
      pinHubTestAuthEnv();
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
      prisma = app.get(PrismaService);
      fixture = await seedWebhookFixture(prisma);
      hub = await hubReqScoped(app, TENANT);
    });

    afterAll(async () => {
      if (prisma) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM webhook_deliveries WHERE endpoint_id IN (SELECT id FROM webhook_endpoints WHERE tenant_id = $1::uuid)`,
          TENANT,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM webhook_endpoints WHERE tenant_id = $1::uuid`,
          TENANT,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM outbox_entries WHERE tenant_id = $1::uuid`,
          TENANT,
        );
      }
      await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    it("GET /admin/webhooks.json returns deliveries + a CSRF token", async () => {
      const res = await hub.get("/admin/webhooks.json");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.deliveries)).toBe(true);
      expect(res.body.deliveries.length).toBeGreaterThan(0);
      expect(typeof res.body.csrfToken).toBe("string");
      expect(res.body.csrfToken.length).toBeGreaterThan(20);
      expect(res.body.filter.status).toBe("ALL");
    });

    it("GET /admin/webhooks.json honours endpoint and eventType filters", async () => {
      const res = await hub.get(
        `/admin/webhooks.json?endpointId=${encodeURIComponent(fixture.endpointId)}&eventType=${encodeURIComponent(fixture.eventType)}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.filter.endpointId).toBe(fixture.endpointId);
      expect(res.body.filter.eventType).toBe(fixture.eventType);
      expect(res.body.deliveries.length).toBeGreaterThan(0);
    });

    it("GET /admin/webhooks.json returns a cursor when there are more rows", async () => {
      const res = await hub.get("/admin/webhooks.json?limit=1");
      expect(res.status).toBe(200);
      expect(res.body.deliveries.length).toBeLessThanOrEqual(1);
      expect("nextCursor" in res.body).toBe(true);
    });

    it("GET /admin/webhooks/aggregates.json returns endpoint stats with a sparkline", async () => {
      const res = await hub.get("/admin/webhooks/aggregates.json");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.endpoints)).toBe(true);
      expect(res.body.endpoints.length).toBeGreaterThan(0);
      const ep = res.body.endpoints[0];
      expect(typeof ep.endpointId).toBe("string");
      expect(typeof ep.total).toBe("number");
      expect(typeof ep.delivered).toBe("number");
      expect(typeof ep.failed).toBe("number");
      expect(Array.isArray(ep.sparkline)).toBe(true);
      expect(ep.sparkline.length).toBeGreaterThan(0);
    });

    it("GET /admin/webhooks/event-types.json returns only registered @WebhookEvent names", async () => {
      const res = await hub.get("/admin/webhooks/event-types.json");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.eventTypes)).toBe(true);
    });

    it("GET /admin/webhooks/:id.json returns a delivery detail or 404", async () => {
      const res = await hub.get(`/admin/webhooks/${encodeURIComponent(fixture.deliveryId)}.json`);
      expect(res.status).toBe(200);
      expect(res.body.delivery.id).toBe(fixture.deliveryId);
      expect(typeof res.body.curl).toBe("string");
      expect(res.body.curl).toContain("curl ");

      const missing = await hub.get("/admin/webhooks/does-not-exist.json");
      expect(missing.status).toBe(404);
    });

    it("POST /admin/webhooks/:id/redeliver requires a CSRF token", async () => {
      const res = await hub
        .post(`/admin/webhooks/${encodeURIComponent(fixture.deliveryId)}/redeliver`)
        .send({});
      expect(res.status).toBe(403);
    });

    it("POST /admin/webhooks/:id/redeliver succeeds with a valid CSRF token", async () => {
      const list = await hub.get("/admin/webhooks.json");
      const csrf = list.body.csrfToken;
      const res = await hub
        .post(`/admin/webhooks/${encodeURIComponent(fixture.deliveryId)}/redeliver`)
        .send({ csrfToken: csrf });
      expect(res.status).toBe(200);
      expect(res.body.delivery.id).toBe(fixture.deliveryId);
      expect(res.body.delivery.attemptCount).toBeGreaterThanOrEqual(2);
    });

    it("POST /admin/webhooks/:id/redeliver rejects a tampered CSRF token", async () => {
      const res = await hub
        .post(`/admin/webhooks/${encodeURIComponent(fixture.deliveryId)}/redeliver`)
        .send({ csrfToken: "tampered.signature" });
      expect(res.status).toBe(403);
    });

    it("POST /admin/webhooks/:id/redeliver returns 404 for unknown ids", async () => {
      const list = await hub.get("/admin/webhooks.json");
      const csrf = list.body.csrfToken;
      const res = await hub
        .post("/admin/webhooks/does-not-exist/redeliver")
        .send({ csrfToken: csrf });
      expect(res.status).toBe(404);
    });
  });

  describe("outside development mode", () => {
    let app: INestApplication;
    let hub: Awaited<ReturnType<typeof hubReqScoped>>;
    let previousNodeEnv: string | undefined;

    beforeAll(async () => {
      previousNodeEnv = process.env.NODE_ENV;
      pinHubTestAuthEnv();
      process.env.NODE_ENV = "production";
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
      hub = await hubReqScoped(app, TENANT);
    });

    afterAll(async () => {
      await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    it("GET /admin/webhooks/aggregates.json 404s in production", async () => {
      const res = await hub.get("/admin/webhooks/aggregates.json");
      expect(res.status).toBe(404);
    });

    it("POST /admin/webhooks/:id/redeliver 404s in production", async () => {
      const res = await hub.post("/admin/webhooks/some-id/redeliver").send({});
      expect(res.status).toBe(404);
    });
  });
});
