import { describe, expect, it } from "vitest";

import { planWebhookTestEvent } from "../../src/core/webhooks/webhook-test-event-planner.js";

/**
 * Story · Webhook Test-Event Planner.
 *
 * Pure validation planner — decides whether a test event can be sent
 * to a given endpoint before the caller dispatches via the real
 * WebhookDispatcher. No I/O, no network, no DB.
 */
describe("Story · Webhook Test-Event Planner", () => {
  const knownEventTypes = ["user.created", "user.updated", "user.deleted"] as const;

  describe("planWebhookTestEvent", () => {
    it("returns ok=true for a valid enabled endpoint with a known event type", () => {
      const result = planWebhookTestEvent({
        endpointId: "ep-1",
        eventType: "user.created",
        knownEventTypes,
        endpointEnabled: true,
      });
      expect(result).toEqual({ ok: true });
    });

    it("returns UNKNOWN_EVENT_TYPE when the event type is not in the registry", () => {
      const result = planWebhookTestEvent({
        endpointId: "ep-1",
        eventType: "order.placed",
        knownEventTypes,
        endpointEnabled: true,
      });
      expect(result).toEqual({ ok: false, errorCode: "UNKNOWN_EVENT_TYPE" });
    });

    it("returns ENDPOINT_DISABLED when the endpoint is disabled", () => {
      const result = planWebhookTestEvent({
        endpointId: "ep-1",
        eventType: "user.created",
        knownEventTypes,
        endpointEnabled: false,
      });
      expect(result).toEqual({ ok: false, errorCode: "ENDPOINT_DISABLED" });
    });

    it("returns ENDPOINT_DISABLED before checking eventType (disabled takes priority)", () => {
      const result = planWebhookTestEvent({
        endpointId: "ep-1",
        eventType: "completely.unknown",
        knownEventTypes,
        endpointEnabled: false,
      });
      // The most actionable error for the operator: the endpoint is off.
      // They'd need to enable it regardless of the event type.
      expect(result).toEqual({ ok: false, errorCode: "ENDPOINT_DISABLED" });
    });

    it("accepts all declared known event types when the endpoint is enabled", () => {
      for (const eventType of knownEventTypes) {
        const result = planWebhookTestEvent({
          endpointId: "ep-1",
          eventType,
          knownEventTypes,
          endpointEnabled: true,
        });
        expect(result, `expected ok=true for eventType="${eventType}"`).toEqual({ ok: true });
      }
    });

    it("returns UNKNOWN_EVENT_TYPE when knownEventTypes is empty and event is provided", () => {
      const result = planWebhookTestEvent({
        endpointId: "ep-1",
        eventType: "user.created",
        knownEventTypes: [],
        endpointEnabled: true,
      });
      // Empty registry means no events are declared — treat as unknown
      // so a misconfigured server doesn't silently swallow test events.
      expect(result).toEqual({ ok: false, errorCode: "UNKNOWN_EVENT_TYPE" });
    });
  });
});
