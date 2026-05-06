import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OUTBOX_DISPATCHERS } from "../../src/core/outbox/outbox.module.js";
import type { OutboxEntry } from "../../src/core/outbox/outbox.js";
import type { OutboxDispatcher } from "../../src/core/outbox/outbox-worker.js";
import { PrismaService } from "../../src/core/prisma/prisma.service.js";
import {
  WEBHOOK_HTTP_CLIENT,
  type WebhookOutboxDispatcher,
} from "../../src/core/webhooks/webhooks.module.js";
import {
  WebhookEvent,
  resetWebhookEventRegistryForTests,
} from "../../src/core/webhooks/webhook-event.decorator.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT_ID = "00000000-0000-0000-0000-0000000000e1";

@WebhookEvent({ name: "user.signup", description: "Test event for outbox dispatcher" })
class UserSignupEvent {}
void UserSignupEvent;

/**
 * Story · Webhook OutboxDispatcher (CF.WH.06+07 — Finding 2).
 *
 * Iter-37 added the outbox + iter-39 the WebhookDispatcher class but
 * the bridge between them — the actual dispatcher registered on
 * `OUTBOX_DISPATCHERS` — was a log-only stub at
 * `webhooks.module.ts:25-27`. Iter-93 closes the loop:
 *  1. The dispatcher reads the outbox entry, queries
 *     `prisma.webhookEndpoint.findMany({where: {tenantId, status:
 *     ACTIVE, events: <pattern matches type>}})` for matching
 *     subscribers.
 *  2. For each match, calls `WebhookDispatcher.dispatch(...)` which
 *     POSTs the body with HMAC + records a WebhookDelivery row +
 *     handles retry / auto-disable per `RetryConfig`.
 *  3. Registers itself onto `OUTBOX_DISPATCHERS` at OnModuleInit
 *     (parallel to iter-92's realtime dispatcher).
 *
 * The HTTP client is bound via the `WEBHOOK_HTTP_CLIENT` token so
 * tests inject a spy + e2e suites don't actually call out.
 */
describe("Story · Webhook OutboxDispatcher", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const httpCalls: { url: string; body: string; headers: Record<string, string> }[] = [];

  beforeAll(async () => {
    process.env.FEATURE_WEBHOOKS_ENABLED = "true";
    const { bootstrap } = await import("../../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    // Override the WebhookHttpClient with a spy.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const httpClient = app.get<any>(WEBHOOK_HTTP_CLIENT);
    httpClient.post = async (url: string, body: string, headers: Record<string, string>) => {
      httpCalls.push({ url, body, headers });
      return { ok: true, status: 200 };
    };

    // After issue #118, the old `tenants` table was dropped. webhook_endpoints.tenant_id
    // has no FK constraint, so no parent row is required — use the id directly.
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM webhook_deliveries WHERE endpoint_id IN (SELECT id FROM webhook_endpoints WHERE tenant_id = $1::uuid)`,
        TENANT_ID,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM webhook_endpoints WHERE tenant_id = $1::uuid`,
        TENANT_ID,
      );
      // No tenant row to delete — tenants table was dropped in issue #118.
    }
    if (app) await app.close();
    resetWebhookEventRegistryForTests();
  });

  it("the WebhookOutboxDispatcher is registered on OUTBOX_DISPATCHERS", () => {
    const dispatchers = app.get<readonly OutboxDispatcher[]>(OUTBOX_DISPATCHERS);
    const names = dispatchers.map((d) => d.name);
    expect(names).toContain("webhook-outbox");
  });

  it("POSTs the body to every matching active webhook endpoint with HMAC + records deliveries", async () => {
    httpCalls.length = 0;
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        tenantId: TENANT_ID,
        url: "https://hooks.example.com/in",
        secret: "fixture-secret-1",
        events: ["user.signup"],
        status: "ACTIVE",
      },
    });

    const dispatchers = app.get<readonly OutboxDispatcher[]>(OUTBOX_DISPATCHERS);
    const dispatcher = dispatchers.find((d) => d.name === "webhook-outbox") as
      | WebhookOutboxDispatcher
      | undefined;
    expect(dispatcher).toBeDefined();

    const entry: OutboxEntry = {
      id: "00000000-0000-0000-0000-0000000000e2",
      seq: 1,
      tenantId: TENANT_ID,
      type: "user.signup",
      payload: { userId: "u-1", email: "alice@example.com" },
      occurredAt: new Date(),
      processedAt: null,
    };
    await dispatcher!.dispatch(entry);

    expect(httpCalls).toHaveLength(1);
    expect(httpCalls[0]?.url).toBe("https://hooks.example.com/in");
    expect(httpCalls[0]?.headers["webhook-id"]).toBe(entry.id);
    expect(httpCalls[0]?.headers["webhook-signature"]).toMatch(/^t=\d+,v1=/);

    // Debug: query via raw SQL to side-step any model-accessor issues.
    const rawRows = (await prisma.$queryRawUnsafe(
      `SELECT id, status, status_code FROM webhook_deliveries WHERE endpoint_id = $1::uuid`,
      endpoint.id,
    )) as Array<{ id: string; status: string; status_code: number | null }>;
    expect(rawRows).toHaveLength(1);
    expect(rawRows[0]?.status).toBe("DELIVERED");
    expect(rawRows[0]?.status_code).toBe(200);
  });

  it("skips DISABLED endpoints (no HTTP call, no delivery row)", async () => {
    httpCalls.length = 0;
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        tenantId: TENANT_ID,
        url: "https://hooks.disabled.example.com/in",
        secret: "fixture-secret-2",
        events: ["user.signup"],
        status: "DISABLED",
      },
    });

    const dispatchers = app.get<readonly OutboxDispatcher[]>(OUTBOX_DISPATCHERS);
    const dispatcher = dispatchers.find((d) => d.name === "webhook-outbox")!;

    const entry: OutboxEntry = {
      id: "00000000-0000-0000-0000-0000000000e3",
      seq: 2,
      tenantId: TENANT_ID,
      type: "user.signup",
      payload: { userId: "u-2" },
      occurredAt: new Date(),
      processedAt: null,
    };
    await dispatcher.dispatch(entry);

    // No HTTP call to the DISABLED endpoint URL.
    const calledDisabled = httpCalls.some((c) => c.url.includes("disabled"));
    expect(calledDisabled).toBe(false);

    // No delivery row for the DISABLED endpoint.
    const deliveries = await prisma.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
    });
    expect(deliveries).toHaveLength(0);
  });

  it("skips endpoints in other tenants (cross-tenant isolation)", async () => {
    // After issue #118, tenants table was dropped — use a plain UUID for the other
    // tenant. webhook_endpoints.tenant_id has no FK so no parent row is needed.
    httpCalls.length = 0;
    const otherTenantId = "00000000-0000-0000-0000-0000000000ef";
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        tenantId: otherTenantId,
        url: "https://hooks.othertenant.example.com/in",
        secret: "fixture-secret-3",
        events: ["user.signup"],
        status: "ACTIVE",
      },
    });

    try {
      const dispatchers = app.get<readonly OutboxDispatcher[]>(OUTBOX_DISPATCHERS);
      const dispatcher = dispatchers.find((d) => d.name === "webhook-outbox")!;

      const entry: OutboxEntry = {
        id: "00000000-0000-0000-0000-0000000000e4",
        seq: 3,
        tenantId: TENANT_ID, // not otherTenantId
        type: "user.signup",
        payload: {},
        occurredAt: new Date(),
        processedAt: null,
      };
      await dispatcher.dispatch(entry);

      const calledOther = httpCalls.some((c) => c.url.includes("othertenant"));
      expect(calledOther).toBe(false);

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { endpointId: endpoint.id },
      });
      expect(deliveries).toHaveLength(0);
    } finally {
      // Cleanup endpoint only — no tenant row to delete.
      await prisma.webhookEndpoint.delete({ where: { id: endpoint.id } }).catch(() => undefined);
    }
  });

  it("skips entries whose type doesn't match any subscriber's events array", async () => {
    httpCalls.length = 0;
    const dispatchers = app.get<readonly OutboxDispatcher[]>(OUTBOX_DISPATCHERS);
    const dispatcher = dispatchers.find((d) => d.name === "webhook-outbox")!;

    const entry: OutboxEntry = {
      id: "00000000-0000-0000-0000-0000000000e5",
      seq: 4,
      tenantId: TENANT_ID,
      type: "tenant.deleted", // no subscriber listens for this
      payload: {},
      occurredAt: new Date(),
      processedAt: null,
    };
    await dispatcher.dispatch(entry);

    expect(httpCalls).toHaveLength(0);
  });
});
