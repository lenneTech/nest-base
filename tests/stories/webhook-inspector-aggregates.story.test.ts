import { describe, expect, it } from "vitest";

import {
  buildEndpointAggregates,
  buildSparkline,
  filterDeliveries,
  type DeliveryAggregateInput,
  type DeliveryFilterInput,
} from "../../src/core/webhooks/inspector-aggregates.js";

/**
 * Story · Webhook-Inspector aggregates.
 *
 * Pure planners over a list of delivery records — counts, p95
 * latency, sparklines, filter-DSL. Inspector UI consumes these to
 * paint endpoint sidebar + delivery list. No I/O — every helper is a
 * pure function over an in-memory record array.
 */

describe("Story · Webhook-Inspector aggregates", () => {
  const NOW = Date.parse("2026-01-15T12:00:00Z");

  function record(over: Partial<DeliveryAggregateInput>): DeliveryAggregateInput {
    return {
      id: over.id ?? "d1",
      endpointId: over.endpointId ?? "ep-1",
      endpointUrl: over.endpointUrl ?? "https://example.com/hook",
      eventType: over.eventType ?? "user.created",
      status: over.status ?? "DELIVERED",
      statusCode: over.statusCode,
      attemptCount: over.attemptCount ?? 1,
      latencyMs: over.latencyMs ?? 50,
      occurredAt: over.occurredAt ?? new Date(NOW - 60_000).toISOString(),
      errorMessage: over.errorMessage,
    };
  }

  describe("buildEndpointAggregates", () => {
    it("returns an empty list when no records exist", () => {
      const result = buildEndpointAggregates({ deliveries: [], now: NOW, windowMs: 86_400_000 });
      expect(result).toEqual([]);
    });

    it("groups deliveries by endpointId and counts total / delivered / failed", () => {
      const result = buildEndpointAggregates({
        deliveries: [
          record({ id: "1", endpointId: "ep-1", status: "DELIVERED" }),
          record({ id: "2", endpointId: "ep-1", status: "FAILED" }),
          record({ id: "3", endpointId: "ep-1", status: "DELIVERED" }),
          record({ id: "4", endpointId: "ep-2", status: "DELIVERED" }),
        ],
        now: NOW,
        windowMs: 86_400_000,
      });
      const ep1 = result.find((e) => e.endpointId === "ep-1");
      expect(ep1).toBeDefined();
      expect(ep1!.total).toBe(3);
      expect(ep1!.delivered).toBe(2);
      expect(ep1!.failed).toBe(1);
      const ep2 = result.find((e) => e.endpointId === "ep-2");
      expect(ep2!.total).toBe(1);
    });

    it("computes p95 latency over delivered records only", () => {
      const records = Array.from({ length: 20 }, (_, i) =>
        record({
          id: `d${i}`,
          endpointId: "ep-1",
          status: "DELIVERED",
          latencyMs: (i + 1) * 10,
        }),
      );
      const result = buildEndpointAggregates({
        deliveries: records,
        now: NOW,
        windowMs: 86_400_000,
      });
      const ep1 = result[0]!;
      // p95 of [10..200] is the 19th value (0-indexed 18) → 190
      expect(ep1.p95LatencyMs).toBeGreaterThanOrEqual(180);
      expect(ep1.p95LatencyMs).toBeLessThanOrEqual(200);
    });

    it("computes failureRate as failed / total over the window", () => {
      const result = buildEndpointAggregates({
        deliveries: [
          record({ id: "1", endpointId: "ep-1", status: "DELIVERED" }),
          record({ id: "2", endpointId: "ep-1", status: "FAILED" }),
          record({ id: "3", endpointId: "ep-1", status: "FAILED" }),
          record({ id: "4", endpointId: "ep-1", status: "DELIVERED" }),
        ],
        now: NOW,
        windowMs: 86_400_000,
      });
      const ep1 = result[0]!;
      expect(ep1.failureRate).toBeCloseTo(0.5, 5);
    });

    it("ignores records older than the window", () => {
      const result = buildEndpointAggregates({
        deliveries: [
          record({ id: "1", endpointId: "ep-1", status: "DELIVERED" }),
          record({
            id: "2",
            endpointId: "ep-1",
            status: "FAILED",
            occurredAt: new Date(NOW - 100_000_000).toISOString(),
          }),
        ],
        now: NOW,
        windowMs: 86_400_000,
      });
      const ep1 = result[0]!;
      expect(ep1.total).toBe(1);
      expect(ep1.failed).toBe(0);
    });

    it("sorts endpoints by total deliveries descending", () => {
      const result = buildEndpointAggregates({
        deliveries: [
          record({ id: "1", endpointId: "ep-low", status: "DELIVERED" }),
          record({ id: "2", endpointId: "ep-high", status: "DELIVERED" }),
          record({ id: "3", endpointId: "ep-high", status: "DELIVERED" }),
          record({ id: "4", endpointId: "ep-high", status: "DELIVERED" }),
        ],
        now: NOW,
        windowMs: 86_400_000,
      });
      expect(result[0]!.endpointId).toBe("ep-high");
      expect(result[1]!.endpointId).toBe("ep-low");
    });

    it("preserves the endpointUrl from the most recent delivery", () => {
      const result = buildEndpointAggregates({
        deliveries: [
          record({
            id: "old",
            endpointId: "ep-1",
            endpointUrl: "https://old.example/hook",
            occurredAt: new Date(NOW - 3600_000).toISOString(),
          }),
          record({
            id: "new",
            endpointId: "ep-1",
            endpointUrl: "https://new.example/hook",
            occurredAt: new Date(NOW - 60_000).toISOString(),
          }),
        ],
        now: NOW,
        windowMs: 86_400_000,
      });
      expect(result[0]!.endpointUrl).toBe("https://new.example/hook");
    });
  });

  describe("buildSparkline", () => {
    it("returns one bucket per slice and aggregates delivery counts", () => {
      const records = [
        record({ id: "1", occurredAt: new Date(NOW - 60_000).toISOString() }),
        record({ id: "2", occurredAt: new Date(NOW - 60_000).toISOString() }),
        record({ id: "3", occurredAt: new Date(NOW - 3600_000).toISOString() }),
      ];
      const sparkline = buildSparkline({
        deliveries: records,
        now: NOW,
        bucketCount: 24,
        bucketMs: 3600_000,
      });
      expect(sparkline.length).toBe(24);
      // Latest bucket should hold the two recent records.
      expect(sparkline[23]).toBe(2);
      // The bucket exactly one hour ago holds the third record.
      expect(sparkline[22]).toBe(1);
    });

    it("returns all-zero buckets for an empty input", () => {
      const sparkline = buildSparkline({
        deliveries: [],
        now: NOW,
        bucketCount: 6,
        bucketMs: 60_000,
      });
      expect(sparkline).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it("ignores records outside the sparkline window", () => {
      const sparkline = buildSparkline({
        deliveries: [record({ id: "1", occurredAt: new Date(NOW - 3600_000 * 50).toISOString() })],
        now: NOW,
        bucketCount: 24,
        bucketMs: 3600_000,
      });
      expect(sparkline.every((c) => c === 0)).toBe(true);
    });
  });

  describe("filterDeliveries", () => {
    function fr(over: Partial<DeliveryAggregateInput>): DeliveryAggregateInput {
      return record(over);
    }

    const dataset: DeliveryAggregateInput[] = [
      fr({
        id: "a",
        endpointId: "ep-1",
        eventType: "user.created",
        status: "DELIVERED",
        occurredAt: new Date(NOW - 60_000).toISOString(),
      }),
      fr({
        id: "b",
        endpointId: "ep-2",
        eventType: "user.deleted",
        status: "FAILED",
        occurredAt: new Date(NOW - 120_000).toISOString(),
      }),
      fr({
        id: "c-with-search",
        endpointId: "ep-1",
        eventType: "user.updated",
        status: "DELIVERED",
        occurredAt: new Date(NOW - 180_000).toISOString(),
      }),
    ];

    function asFilter(over: Partial<DeliveryFilterInput> = {}): DeliveryFilterInput {
      return { deliveries: dataset, ...over };
    }

    it("returns everything when no filter is given", () => {
      expect(filterDeliveries(asFilter()).length).toBe(3);
    });

    it("filters by endpointId", () => {
      const out = filterDeliveries(asFilter({ endpointId: "ep-1" }));
      expect(out.length).toBe(2);
      expect(out.every((r) => r.endpointId === "ep-1")).toBe(true);
    });

    it("filters by status", () => {
      const out = filterDeliveries(asFilter({ status: "FAILED" }));
      expect(out.length).toBe(1);
      expect(out[0]!.id).toBe("b");
    });

    it("filters by eventType", () => {
      const out = filterDeliveries(asFilter({ eventType: "user.deleted" }));
      expect(out.length).toBe(1);
      expect(out[0]!.id).toBe("b");
    });

    it("filters by ID substring search", () => {
      const out = filterDeliveries(asFilter({ search: "with-search" }));
      expect(out.length).toBe(1);
      expect(out[0]!.id).toBe("c-with-search");
    });

    it("filters by from / to time range (inclusive)", () => {
      const out = filterDeliveries(
        asFilter({
          from: new Date(NOW - 130_000).toISOString(),
          to: new Date(NOW - 50_000).toISOString(),
        }),
      );
      expect(out.length).toBe(2);
      expect(out.map((r) => r.id).sort()).toEqual(["a", "b"]);
    });

    it("combines filters (status + endpointId)", () => {
      const out = filterDeliveries(asFilter({ status: "DELIVERED", endpointId: "ep-1" }));
      expect(out.length).toBe(2);
    });

    it("treats an empty search string as no filter", () => {
      const out = filterDeliveries(asFilter({ search: "" }));
      expect(out.length).toBe(3);
    });
  });
});
