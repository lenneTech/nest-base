import { describe, expect, it } from "vitest";

import { WebhookInspectorBuffer } from "../../src/core/webhooks/inspector-store.js";

/**
 * Story · In-memory inspector buffer.
 *
 * Holds the last N delivery records the inspector page reads. The
 * dispatcher records into the buffer; the React page fetches via
 * the JSON sidecars. Pure data structure, no I/O.
 */

describe("Story · WebhookInspectorBuffer", () => {
  it("starts empty and reports size 0", () => {
    const buf = new WebhookInspectorBuffer();
    expect(buf.size()).toBe(0);
    expect(buf.recent()).toEqual([]);
  });

  it("records appended deliveries in insertion order", () => {
    const buf = new WebhookInspectorBuffer({ maxRecords: 10 });
    buf.record({
      id: "d1",
      endpointId: "ep-1",
      endpointUrl: "https://example/hook",
      eventType: "user.created",
      status: "DELIVERED",
      attemptCount: 1,
      latencyMs: 100,
      occurredAt: "2026-01-15T12:00:00Z",
    });
    buf.record({
      id: "d2",
      endpointId: "ep-1",
      endpointUrl: "https://example/hook",
      eventType: "user.deleted",
      status: "FAILED",
      attemptCount: 2,
      occurredAt: "2026-01-15T12:01:00Z",
    });
    expect(buf.size()).toBe(2);
    const recent = buf.recent();
    expect(recent.map((r) => r.id)).toEqual(["d1", "d2"]);
  });

  it("evicts oldest records when over capacity", () => {
    const buf = new WebhookInspectorBuffer({ maxRecords: 2 });
    buf.record(makeDelivery("a"));
    buf.record(makeDelivery("b"));
    buf.record(makeDelivery("c"));
    expect(buf.size()).toBe(2);
    expect(buf.recent().map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("findById returns the matching record or null", () => {
    const buf = new WebhookInspectorBuffer();
    buf.record(makeDelivery("a"));
    buf.record(makeDelivery("b"));
    expect(buf.findById("b")?.id).toBe("b");
    expect(buf.findById("missing")).toBeNull();
  });

  it("appendAttempt updates attemptCount + latency on a re-deliver", () => {
    const buf = new WebhookInspectorBuffer();
    buf.record(makeDelivery("a", { attemptCount: 1, status: "FAILED" }));
    buf.appendAttempt("a", {
      status: "DELIVERED",
      statusCode: 200,
      latencyMs: 42,
      occurredAt: "2026-01-15T13:00:00Z",
    });
    const updated = buf.findById("a");
    expect(updated?.attemptCount).toBe(2);
    expect(updated?.status).toBe("DELIVERED");
    expect(updated?.latencyMs).toBe(42);
  });

  it("appendAttempt is a noop when the id is unknown", () => {
    const buf = new WebhookInspectorBuffer();
    expect(() =>
      buf.appendAttempt("missing", {
        status: "DELIVERED",
        occurredAt: "2026-01-15T13:00:00Z",
      }),
    ).not.toThrow();
  });

  it("clear removes all records", () => {
    const buf = new WebhookInspectorBuffer();
    buf.record(makeDelivery("a"));
    buf.clear();
    expect(buf.size()).toBe(0);
  });
});

function makeDelivery(
  id: string,
  over: { attemptCount?: number; status?: "DELIVERED" | "FAILED" | "PENDING" } = {},
): {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventType: string;
  status: "DELIVERED" | "FAILED" | "PENDING";
  attemptCount: number;
  occurredAt: string;
} {
  return {
    id,
    endpointId: "ep-1",
    endpointUrl: "https://example.com/hook",
    eventType: "user.created",
    status: over.status ?? "DELIVERED",
    attemptCount: over.attemptCount ?? 1,
    occurredAt: "2026-01-15T12:00:00Z",
  };
}
