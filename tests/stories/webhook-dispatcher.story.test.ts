import { describe, expect, it, vi } from "vitest";

import {
  WebhookDispatcher,
  type WebhookHttpClient,
  type WebhookEndpointStore,
  type WebhookDeliveryStore,
  type WebhookEndpointSnapshot,
} from "../../src/core/webhooks/webhook-dispatcher.js";
import { verifyHmacSignatureHeader } from "../../src/core/webhooks/hmac-signature.js";

/**
 * Story · Webhook-Dispatcher (PLAN.md §10).
 *
 * Glues the HMAC-signature, retry-policy, and fanout helpers from
 * iteration 48 into a service that:
 *   - POSTs the body with `t=,v1=` HMAC header
 *   - on success → marks delivery DELIVERED, resets consecutive_failures
 *   - on failure → increments consecutive_failures, schedules retry,
 *     auto-disables at the threshold
 *
 * HTTP + storage stay behind small interfaces so the unit suite runs
 * without a network or DB.
 */
describe("Story · Webhook Dispatcher", () => {
  function setup(initialEndpoint?: Partial<WebhookEndpointSnapshot>) {
    const endpoint: WebhookEndpointSnapshot = {
      id: "ep1",
      tenantId: "t1",
      url: "https://hook.example/incoming",
      secret: "sekret-key",
      status: "ACTIVE",
      consecutiveFailures: 0,
      ...initialEndpoint,
    };
    const endpointStore: WebhookEndpointStore = {
      async findById(id) {
        return id === endpoint.id ? { ...endpoint } : null;
      },
      async setFailureCount(id, count) {
        if (id === endpoint.id) endpoint.consecutiveFailures = count;
      },
      async disable(id) {
        if (id === endpoint.id) endpoint.status = "DISABLED";
      },
    };
    const deliveries: Array<{
      id: string;
      status: string;
      statusCode?: number;
      attemptCount: number;
    }> = [];
    const deliveryStore: WebhookDeliveryStore = {
      async record(delivery) {
        deliveries.push({ ...delivery });
      },
    };
    return { endpoint, endpointStore, deliveryStore, deliveries };
  }

  it("signs the body and POSTs to the endpoint URL", async () => {
    const { endpoint, endpointStore, deliveryStore } = setup();
    const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    const http: WebhookHttpClient = {
      async post(url, body, headers) {
        calls.push({ url, body, headers });
        return { ok: true, status: 200 };
      },
    };
    const dispatcher = new WebhookDispatcher({
      http,
      endpointStore,
      deliveryStore,
      now: () => 1700000000,
    });
    await dispatcher.dispatch({
      endpointId: endpoint.id,
      eventId: "evt-1",
      eventType: "invoice.paid",
      body: '{"amount":100}',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(endpoint.url);
    const sigHeader = calls[0]!.headers["webhook-signature"];
    expect(sigHeader).toBeDefined();
    expect(
      verifyHmacSignatureHeader(endpoint.secret, '{"amount":100}', sigHeader!, {
        now: 1700000000,
        toleranceSeconds: 300,
      }),
    ).toBe(true);
  });

  it("marks delivery DELIVERED + resets consecutive_failures on 2xx", async () => {
    const { endpoint, endpointStore, deliveryStore, deliveries } = setup({
      consecutiveFailures: 3,
    });
    const http: WebhookHttpClient = {
      async post() {
        return { ok: true, status: 204 };
      },
    };
    const dispatcher = new WebhookDispatcher({
      http,
      endpointStore,
      deliveryStore,
      now: () => 1700000000,
    });
    await dispatcher.dispatch({
      endpointId: endpoint.id,
      eventId: "evt-1",
      eventType: "x",
      body: "{}",
    });
    expect(endpoint.consecutiveFailures).toBe(0);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("DELIVERED");
    expect(deliveries[0]!.statusCode).toBe(204);
  });

  it("on 5xx → increments consecutive_failures, status FAILED", async () => {
    const { endpoint, endpointStore, deliveryStore, deliveries } = setup({
      consecutiveFailures: 2,
    });
    const http: WebhookHttpClient = {
      async post() {
        return { ok: false, status: 500 };
      },
    };
    const dispatcher = new WebhookDispatcher({
      http,
      endpointStore,
      deliveryStore,
      now: () => 1700000000,
    });
    await dispatcher.dispatch({
      endpointId: endpoint.id,
      eventId: "evt-1",
      eventType: "x",
      body: "{}",
    });
    expect(endpoint.consecutiveFailures).toBe(3);
    expect(endpoint.status).toBe("ACTIVE");
    expect(deliveries[0]!.status).toBe("FAILED");
  });

  it("auto-disables the endpoint after the configured failure threshold", async () => {
    const { endpoint, endpointStore, deliveryStore } = setup({ consecutiveFailures: 19 });
    const http: WebhookHttpClient = {
      async post() {
        return { ok: false, status: 500 };
      },
    };
    const dispatcher = new WebhookDispatcher({
      http,
      endpointStore,
      deliveryStore,
      now: () => 1700000000,
      retry: { initialDelayMs: 1000, factor: 2, maxDelayMs: 60000, autoDisableAfter: 20 },
    });
    await dispatcher.dispatch({
      endpointId: endpoint.id,
      eventId: "evt-1",
      eventType: "x",
      body: "{}",
    });
    expect(endpoint.consecutiveFailures).toBe(20);
    expect(endpoint.status).toBe("DISABLED");
  });

  it("skips dispatch when the endpoint is already DISABLED", async () => {
    const { endpoint, endpointStore, deliveryStore, deliveries } = setup({ status: "DISABLED" });
    const post = vi.fn();
    const http: WebhookHttpClient = { post: post as never };
    const dispatcher = new WebhookDispatcher({
      http,
      endpointStore,
      deliveryStore,
      now: () => 1700000000,
    });
    await dispatcher.dispatch({
      endpointId: endpoint.id,
      eventId: "evt-1",
      eventType: "x",
      body: "{}",
    });
    expect(post).not.toHaveBeenCalled();
    expect(deliveries).toHaveLength(0);
  });

  it("throws when the endpoint id is unknown", async () => {
    const { endpointStore, deliveryStore } = setup();
    const http: WebhookHttpClient = {
      async post() {
        return { ok: true, status: 200 };
      },
    };
    const dispatcher = new WebhookDispatcher({
      http,
      endpointStore,
      deliveryStore,
      now: () => 1700000000,
    });
    await expect(
      dispatcher.dispatch({ endpointId: "missing", eventId: "evt-1", eventType: "x", body: "{}" }),
    ).rejects.toThrow();
  });

  it("a thrown HTTP error is treated as a failure (not an unhandled exception)", async () => {
    const { endpoint, endpointStore, deliveryStore, deliveries } = setup();
    const http: WebhookHttpClient = {
      async post() {
        throw new Error("connect ETIMEDOUT");
      },
    };
    const dispatcher = new WebhookDispatcher({
      http,
      endpointStore,
      deliveryStore,
      now: () => 1700000000,
    });
    await dispatcher.dispatch({
      endpointId: endpoint.id,
      eventId: "evt-1",
      eventType: "x",
      body: "{}",
    });
    expect(endpoint.consecutiveFailures).toBe(1);
    expect(deliveries[0]!.status).toBe("FAILED");
  });
});
