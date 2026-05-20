import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  WebhookEvent,
  getRegisteredWebhookEvents,
  resetWebhookEventRegistryForTests,
} from "../../src/core/webhooks/webhook-event.decorator.js";
import {
  type WebhookDeliveryStore,
  type WebhookEndpointSnapshot,
  type WebhookEndpointStore,
  type WebhookHttpClient,
  WebhookDispatcher,
  WebhookEventTypeNotRegisteredError,
} from "../../src/core/webhooks/webhook-dispatcher.js";
import { hubReqScoped, pinHubTestAuthEnv } from "../helpers/hub-request.js";

const TENANT = "11111111-1111-1111-1111-111111111111";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Story · @WebhookEvent registry hooked into runtime
 * (CF.WH.04 — Finding 8 from iter-84 reviewer).
 *
 * Iter-81 added the `@WebhookEvent` decorator + global registry but
 * neither the dispatcher nor any admin endpoint consumed
 * `getRegisteredWebhookEvents()`. The decorator was decorative.
 *
 * Iter-91 closes the loop with two consumers:
 *  1. `WebhookDispatcher.dispatch(input)` validates `input.eventType`
 *     against the registry — unregistered events throw
 *     `WebhookEventTypeNotRegisteredError` (HTTP 400 via the
 *     ProblemDetailsFilter mapping). When the registry is empty
 *     (project hasn't declared any events yet), validation is
 *     bypassed for backward-compat.
 *  2. `GET /hub/webhook-events.json` — admin endpoint that surfaces
 *     `getRegisteredWebhookEvents()` so the dev-portal UI can render
 *     "Available webhook events" without hand-crafting the list.
 */

@WebhookEvent({ name: "test.user.created", description: "Test event for registry validation" })
class TestUserCreatedEvent {}
// Reference the class so tsc/oxlint don't strip it.
void TestUserCreatedEvent;

@WebhookEvent({ name: "test.tenant.invited", description: "Test event #2" })
class TestTenantInvitedEvent {}
void TestTenantInvitedEvent;

describe("Story · @WebhookEvent registry hooked into runtime", () => {
  describe("WebhookDispatcher validates against registry", () => {
    let endpointStore: WebhookEndpointStore;
    let deliveryStore: WebhookDeliveryStore;
    let http: WebhookHttpClient;

    beforeAll(() => {
      const endpoint: WebhookEndpointSnapshot = {
        id: "ep-1",
        tenantId: "t-1",
        url: "https://hooks.example.com/in",
        secret: "s",
        status: "ACTIVE",
        consecutiveFailures: 0,
      };
      endpointStore = {
        async findById(id) {
          return id === "ep-1" ? endpoint : null;
        },
        async setFailureCount() {},
        async disable() {},
      };
      deliveryStore = { async record() {} };
      http = {
        async post() {
          return { ok: true, status: 200 };
        },
      };
    });

    it("rejects an event type that is not registered (registry has entries)", async () => {
      const dispatcher = new WebhookDispatcher({
        endpointStore,
        deliveryStore,
        http,
        now: () => 1,
      });
      await expect(
        dispatcher.dispatch({
          endpointId: "ep-1",
          eventId: "evt-1",
          eventType: "completely.unknown.event",
          body: "{}",
        }),
      ).rejects.toBeInstanceOf(WebhookEventTypeNotRegisteredError);
    });

    it("dispatches successfully when the event type is registered", async () => {
      const recorded: { eventId: string }[] = [];
      const dispatcher = new WebhookDispatcher({
        endpointStore,
        deliveryStore: {
          async record(rec) {
            recorded.push({ eventId: rec.eventId });
          },
        },
        http,
        now: () => 1,
      });
      await dispatcher.dispatch({
        endpointId: "ep-1",
        eventId: "evt-2",
        eventType: "test.user.created",
        body: "{}",
      });
      expect(recorded).toEqual([{ eventId: "evt-2" }]);
    });

    it("when the registry is empty the dispatcher accepts any event type (backward-compat)", async () => {
      // Capture state, clear registry, dispatch arbitrary event,
      // restore registered events.
      const before = getRegisteredWebhookEvents().map((m) => ({ ...m }));
      try {
        resetWebhookEventRegistryForTests();
        const dispatcher = new WebhookDispatcher({
          endpointStore,
          deliveryStore,
          http,
          now: () => 1,
        });
        await dispatcher.dispatch({
          endpointId: "ep-1",
          eventId: "evt-3",
          eventType: "anything.goes",
          body: "{}",
        });
      } finally {
        // Re-register the test events so the next describe block sees them.
        for (const meta of before) {
          // Recreate decoration through a synthetic class.
          @WebhookEvent({
            name: meta.name,
            ...(meta.description !== undefined ? { description: meta.description } : {}),
            ...(meta.version !== undefined ? { version: meta.version } : {}),
          })
          class Restored {}
          void Restored;
        }
      }
    });
  });

  describe("GET /hub/webhook-events.json surfaces the registry", () => {
    let app: INestApplication;
    let hub: Awaited<ReturnType<typeof hubReqScoped>>;
    let previousNodeEnv: string | undefined;

    beforeAll(async () => {
      previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      const { bootstrap } = await import("../../src/core/app/bootstrap.js");
      pinHubTestAuthEnv();
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
      hub = await hubReqScoped(app, TENANT);
    });

    afterAll(async () => {
      if (app) await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    it("returns the @WebhookEvent registry as a JSON array", async () => {
      const res = await hub.get("/hub/webhook-events.json");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.events)).toBe(true);
      const names = (res.body.events as Array<{ name: string }>).map((e) => e.name);
      expect(names).toContain("test.user.created");
      expect(names).toContain("test.tenant.invited");
    });

    it("each entry carries name + description + version", async () => {
      const res = await hub.get("/hub/webhook-events.json");
      const entry = (
        res.body.events as Array<{ name: string; description?: string; version: number }>
      ).find((e) => e.name === "test.user.created");
      expect(entry).toBeDefined();
      expect(entry?.description).toContain("registry validation");
      expect(typeof entry?.version).toBe("number");
    });
  });
});
