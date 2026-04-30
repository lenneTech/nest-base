import { describe, expect, it } from "vitest";

import {
  aggregateJobsByQueue,
  buildJobAggregates,
  computeFailureRate,
  computeP95Latency,
  countByState,
  type JobRecord,
} from "../../src/core/jobs/dev-jobs-aggregations.js";

/**
 * Story · Dev Jobs Aggregations.
 *
 * Pure-planner layer for the Jobs-Dashboard. The functions here take
 * a flat list of `JobRecord` rows (whatever shape the runner produces
 * — in-memory adapter today, pg-boss adapter tomorrow) and roll them
 * up into the counters / latency stats / per-queue snapshots the
 * dashboard needs.
 *
 * Pure-planner contract:
 *   - never reads from a DB
 *   - never mutates input arrays
 *   - deterministic given the input list
 *
 * The runner (`InMemoryJobQueue.listJobs()` / future pg-boss adapter)
 * is responsible for actually hitting storage; everything below is
 * unit-testable in isolation.
 */
describe("Story · Dev Jobs Aggregations", () => {
  function record(overrides: Partial<JobRecord>): JobRecord {
    return {
      id: "job-1",
      name: "test-queue",
      state: "completed",
      attempt: 1,
      payload: {},
      createdAt: 1_000_000,
      ...overrides,
    };
  }

  describe("countByState()", () => {
    it("returns zero for every state when the list is empty", () => {
      const counts = countByState([]);
      expect(counts.created).toBe(0);
      expect(counts.active).toBe(0);
      expect(counts.completed).toBe(0);
      expect(counts.failed).toBe(0);
      expect(counts.cancelled).toBe(0);
      expect(counts.retry).toBe(0);
    });

    it("groups records by their state and totals each bucket", () => {
      const counts = countByState([
        record({ id: "a", state: "completed" }),
        record({ id: "b", state: "completed" }),
        record({ id: "c", state: "failed" }),
        record({ id: "d", state: "created" }),
        record({ id: "e", state: "active" }),
        record({ id: "f", state: "retry" }),
        record({ id: "g", state: "cancelled" }),
      ]);
      expect(counts.completed).toBe(2);
      expect(counts.failed).toBe(1);
      expect(counts.created).toBe(1);
      expect(counts.active).toBe(1);
      expect(counts.retry).toBe(1);
      expect(counts.cancelled).toBe(1);
    });
  });

  describe("computeP95Latency()", () => {
    it("returns null when no completed jobs have a duration", () => {
      expect(computeP95Latency([])).toBeNull();
      expect(computeP95Latency([record({ state: "completed" })])).toBeNull();
    });

    it("ignores non-completed jobs", () => {
      const ms = computeP95Latency([
        record({ state: "active", startedAt: 1, completedAt: 100 }),
        record({ state: "failed", startedAt: 1, completedAt: 100 }),
      ]);
      expect(ms).toBeNull();
    });

    it("returns the 95th percentile of completed-job durations", () => {
      // 20 records with durations 1..20ms — p95 is the 19th value (95% of 20).
      const records: JobRecord[] = Array.from({ length: 20 }, (_, i) =>
        record({
          id: `job-${i}`,
          state: "completed",
          startedAt: 0,
          completedAt: i + 1,
        }),
      );
      const ms = computeP95Latency(records);
      expect(ms).toBeGreaterThanOrEqual(19);
      expect(ms).toBeLessThanOrEqual(20);
    });
  });

  describe("computeFailureRate()", () => {
    it("returns 0 on an empty list (no division-by-zero)", () => {
      expect(computeFailureRate([])).toBe(0);
    });

    it("returns 0 when every job completed", () => {
      const list = [record({ state: "completed" }), record({ state: "completed" })];
      expect(computeFailureRate(list)).toBe(0);
    });

    it("returns the failed share of finished jobs (failed / (failed + completed))", () => {
      // 1 failed, 3 completed → 25 %.
      const list = [
        record({ id: "a", state: "completed" }),
        record({ id: "b", state: "completed" }),
        record({ id: "c", state: "completed" }),
        record({ id: "d", state: "failed" }),
      ];
      expect(computeFailureRate(list)).toBeCloseTo(0.25, 5);
    });

    it("ignores still-pending / active jobs (not yet finished)", () => {
      const list = [
        record({ id: "a", state: "active" }),
        record({ id: "b", state: "created" }),
        record({ id: "c", state: "completed" }),
        record({ id: "d", state: "failed" }),
      ];
      expect(computeFailureRate(list)).toBeCloseTo(0.5, 5);
    });
  });

  describe("aggregateJobsByQueue()", () => {
    it("returns an empty list when no jobs are passed", () => {
      expect(aggregateJobsByQueue([])).toEqual([]);
    });

    it("groups jobs by queue name and emits per-queue counts + p95", () => {
      const list = [
        record({ id: "a", name: "emails", state: "completed", startedAt: 0, completedAt: 100 }),
        record({ id: "b", name: "emails", state: "completed", startedAt: 0, completedAt: 200 }),
        record({ id: "c", name: "emails", state: "failed" }),
        record({ id: "d", name: "imports", state: "active" }),
        record({ id: "e", name: "imports", state: "completed", startedAt: 0, completedAt: 50 }),
      ];
      const queues = aggregateJobsByQueue(list);
      expect(queues).toHaveLength(2);
      const emails = queues.find((q) => q.name === "emails");
      expect(emails).toBeDefined();
      expect(emails!.counts.completed).toBe(2);
      expect(emails!.counts.failed).toBe(1);
      expect(emails!.total).toBe(3);
      expect(emails!.p95LatencyMs).not.toBeNull();
      const imports = queues.find((q) => q.name === "imports");
      expect(imports!.counts.active).toBe(1);
      expect(imports!.counts.completed).toBe(1);
      expect(imports!.total).toBe(2);
    });

    it("returns queues sorted alphabetically for stable rendering", () => {
      const list = [
        record({ id: "a", name: "z-queue" }),
        record({ id: "b", name: "a-queue" }),
        record({ id: "c", name: "m-queue" }),
      ];
      const names = aggregateJobsByQueue(list).map((q) => q.name);
      expect(names).toEqual(["a-queue", "m-queue", "z-queue"]);
    });
  });

  describe("buildJobAggregates()", () => {
    it("returns the full snapshot the dashboard renders", () => {
      const list = [
        record({ id: "a", name: "q1", state: "completed", startedAt: 0, completedAt: 10 }),
        record({ id: "b", name: "q1", state: "failed" }),
        record({ id: "c", name: "q2", state: "active" }),
      ];
      const snapshot = buildJobAggregates(list);
      expect(snapshot.totalJobs).toBe(3);
      expect(snapshot.totals.completed).toBe(1);
      expect(snapshot.totals.failed).toBe(1);
      expect(snapshot.totals.active).toBe(1);
      expect(snapshot.queues).toHaveLength(2);
      expect(snapshot.failureRate).toBeCloseTo(0.5, 5);
      // p95 over a single 10 ms job is 10.
      expect(snapshot.p95LatencyMs).toBe(10);
    });

    it("does not mutate the input array", () => {
      const list = [record({ id: "a", name: "q1", state: "completed" })];
      const before = [...list];
      buildJobAggregates(list);
      expect(list).toEqual(before);
    });
  });
});
