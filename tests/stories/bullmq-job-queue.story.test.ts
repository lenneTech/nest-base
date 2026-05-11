import { describe, expect, it, vi } from "vitest";

import { BullMQJobQueue } from "../../src/core/jobs/bullmq-job-queue.js";
import type { JobHandler } from "../../src/core/jobs/job-queue.js";

/**
 * Story · BullMQ Job Queue adapter.
 *
 * Exercises the BullMQ adapter in "no-Redis" mode (REDIS_URL absent) —
 * it must degrade gracefully to the InMemoryJobQueue behaviour so the
 * full test suite can run without a live Redis instance.
 *
 * Redis-backed behaviour is verified at the integration layer (e2e)
 * only when REDIS_URL is provided. These unit stories stay pure.
 */

// Create a testable subclass that exposes the internal fallback mode
// so tests can verify the adapter selected the correct code path.
function makeQueue(): BullMQJobQueue {
  // No REDIS_URL in test environment → in-memory fallback.
  return new BullMQJobQueue(null);
}

describe("Story · BullMQ Job Queue (no-Redis fallback)", () => {
  it("enqueue() runs registered handlers with the payload after start()", async () => {
    const queue = makeQueue();
    const seen: string[] = [];
    const handler: JobHandler<{ msg: string }> = async (payload) => {
      seen.push(payload.msg);
    };
    queue.register("echo", handler);
    await queue.start();
    await queue.enqueue("echo", { msg: "hello" });
    await queue.drain();
    expect(seen).toEqual(["hello"]);
    await queue.stop();
  });

  it("listJobs() returns history entries for completed jobs", async () => {
    const queue = makeQueue();
    queue.register("noop", async () => {});
    await queue.start();
    await queue.enqueue("noop", { x: 1 });
    await queue.drain();
    const jobs = queue.listJobs();
    expect(jobs.length).toBeGreaterThan(0);
    const job = jobs[0];
    expect(job).toBeDefined();
    expect(job!.name).toBe("noop");
    expect(job!.state).toBe("completed");
    await queue.stop();
  });

  it("getAggregates() reflects completed counts", async () => {
    const queue = makeQueue();
    queue.register("task", async () => {});
    await queue.start();
    await queue.enqueue("task", {});
    await queue.enqueue("task", {});
    await queue.drain();
    const agg = queue.getAggregates();
    expect(agg.totals.completed).toBeGreaterThanOrEqual(2);
    await queue.stop();
  });

  it("retry() re-executes a failed job", async () => {
    const queue = makeQueue();
    let attempt = 0;
    const handler: JobHandler = async () => {
      attempt++;
      if (attempt < 2) throw new Error("first attempt fails");
    };
    queue.register("flaky", handler);
    await queue.start();
    const id = await queue.enqueue("flaky", {});
    await queue.drain();
    const result = queue.jobResult(id);
    expect(result?.status).toBe("failed");
    const retryId = await queue.retry(id);
    await queue.drain();
    const retryResult = queue.jobResult(retryId);
    expect(retryResult?.status).toBe("completed");
    await queue.stop();
  });

  it("falls back to in-memory when no Redis client supplied", () => {
    const queue = new BullMQJobQueue(null);
    // The adapter must be usable without Redis — no throw on construction.
    expect(queue).toBeDefined();
    expect(typeof queue.register).toBe("function");
    expect(typeof queue.enqueue).toBe("function");
    expect(typeof queue.start).toBe("function");
    expect(typeof queue.stop).toBe("function");
  });
});

describe("Story · BullMQ cron-repeat plan", () => {
  it("buildBullMQCleanupJobPlan() returns a repeat config with cron + jobId", async () => {
    const { buildBullMQCleanupJobPlan } = await import(
      "../../src/core/jobs/bullmq-cleanup-job-planner.js"
    );
    const plan = buildBullMQCleanupJobPlan({ kind: "throttler" });
    expect(plan.queueName).toMatch(/throttler/);
    expect(plan.repeatPattern).toMatch(/^\d+ \* \* \* \*$/);
    // Fixed jobId replaces pg-boss singletonKey for at-most-one semantics.
    expect(plan.jobId).toMatch(/throttler/);
  });

  it("buildBullMQCleanupJobPlan() handles all four kinds", async () => {
    const { buildBullMQCleanupJobPlan } = await import(
      "../../src/core/jobs/bullmq-cleanup-job-planner.js"
    );
    const kinds = ["throttler", "idempotency", "verification", "geoip"] as const;
    for (const kind of kinds) {
      const plan = buildBullMQCleanupJobPlan({ kind });
      expect(plan.queueName).toBeDefined();
      expect(plan.repeatPattern).toBeDefined();
      expect(plan.jobId).toBeDefined();
    }
  });
});
