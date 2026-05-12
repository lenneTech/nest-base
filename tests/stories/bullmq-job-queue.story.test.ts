import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Story · BullMQ-only job store (issue #141).
 *
 * After this refactor `JobQueueService` is a standalone class that
 * reads and writes exclusively from/to BullMQ (Redis). The
 * `InMemoryJobQueue` Map is no longer the runtime data store — it
 * stays in source only as a test double for consumers that need one.
 *
 * These story tests are intentionally I/O-free: they inspect the
 * source code structure and the exported class hierarchy to prove the
 * production path no longer routes through `InMemoryJobQueue`.
 */

// ---------------------------------------------------------------------------
// 1. JobQueueService must NOT extend InMemoryJobQueue
// ---------------------------------------------------------------------------

describe("Story · BullMQ-only — JobQueueService does not extend InMemoryJobQueue", () => {
  it("JobQueueService class does not inherit from InMemoryJobQueue at runtime", async () => {
    const { JobQueueService } = await import("../../src/core/jobs/jobs.module.js");
    const { InMemoryJobQueue } = await import("../../src/core/jobs/job-queue.js");

    // Instantiation without a real Redis client — the service should
    // accept a null/missing connection and fall back to an in-process BullMQ
    // mode (using ioredis-mock or similar). This test only checks the
    // class hierarchy, not the Redis wiring.
    expect(JobQueueService.prototype).not.toBeInstanceOf(InMemoryJobQueue);
    // Verify the prototype chain does not include InMemoryJobQueue anywhere.
    let proto = Object.getPrototypeOf(JobQueueService.prototype) as object | null;
    while (proto !== null && proto !== Object.prototype) {
      expect(proto).not.toBe(InMemoryJobQueue.prototype);
      proto = Object.getPrototypeOf(proto) as object | null;
    }
  });

  it("BullMQJobQueue class does not extend InMemoryJobQueue", async () => {
    const { BullMQJobQueue } = await import("../../src/core/jobs/bullmq-job-queue.js");
    const { InMemoryJobQueue } = await import("../../src/core/jobs/job-queue.js");

    expect(BullMQJobQueue.prototype).not.toBeInstanceOf(InMemoryJobQueue);
  });
});

// ---------------------------------------------------------------------------
// 2. InMemoryJobQueue remains exported as a test double (not deleted)
// ---------------------------------------------------------------------------

describe("Story · BullMQ-only — InMemoryJobQueue retained as test double", () => {
  it("InMemoryJobQueue is still exported from job-queue.ts", async () => {
    const mod = await import("../../src/core/jobs/job-queue.js");
    expect(typeof mod.InMemoryJobQueue).toBe("function");
  });

  it("InMemoryJobQueue has the expected test-double API surface", async () => {
    const { InMemoryJobQueue } = await import("../../src/core/jobs/job-queue.js");
    const q = new InMemoryJobQueue();
    expect(typeof q.register).toBe("function");
    expect(typeof q.enqueue).toBe("function");
    expect(typeof q.start).toBe("function");
    expect(typeof q.stop).toBe("function");
    expect(typeof q.drain).toBe("function");
    expect(typeof q.listJobs).toBe("function");
    expect(typeof q.getAggregates).toBe("function");
    expect(typeof q.getJob).toBe("function");
    expect(typeof q.retry).toBe("function");
    expect(typeof q.jobResult).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 3. JobQueueService exposes the Hub-required async surface
// ---------------------------------------------------------------------------

describe("Story · BullMQ-only — JobQueueService has async Hub surface", () => {
  it("JobQueueService prototype has enqueue, listJobs, getAggregates, getJob, retry", async () => {
    const { JobQueueService } = await import("../../src/core/jobs/jobs.module.js");
    expect(typeof JobQueueService.prototype.enqueue).toBe("function");
    expect(typeof JobQueueService.prototype.listJobs).toBe("function");
    expect(typeof JobQueueService.prototype.getAggregates).toBe("function");
    expect(typeof JobQueueService.prototype.getJob).toBe("function");
    expect(typeof JobQueueService.prototype.retry).toBe("function");
    expect(typeof JobQueueService.prototype.register).toBe("function");
  });

  it("listJobs() returns a Promise (async method)", async () => {
    const { JobQueueService } = await import("../../src/core/jobs/jobs.module.js");
    const svc = new JobQueueService(null);
    const result = svc.listJobs({});
    // Must return a Promise (or a thenable), not a plain array.
    expect(result).toBeInstanceOf(Promise);
    await result; // should resolve without error
  });

  it("getAggregates() returns a Promise", async () => {
    const { JobQueueService } = await import("../../src/core/jobs/jobs.module.js");
    const svc = new JobQueueService(null);
    const result = svc.getAggregates();
    expect(result).toBeInstanceOf(Promise);
    const agg = await result;
    // Shape check — aggregates must carry totalJobs and queues.
    expect(typeof agg.totalJobs).toBe("number");
    expect(Array.isArray(agg.queues)).toBe(true);
  });

  it("getJob() returns a Promise", async () => {
    const { JobQueueService } = await import("../../src/core/jobs/jobs.module.js");
    const svc = new JobQueueService(null);
    const result = svc.getJob("nonexistent-id");
    expect(result).toBeInstanceOf(Promise);
    const record = await result;
    expect(record).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. FEATURE_JOBS_BULLMQ env var is no longer used
// ---------------------------------------------------------------------------

describe("Story · BullMQ-only — FEATURE_JOBS_BULLMQ env var removed from src/", () => {
  it("no source file references FEATURE_JOBS_BULLMQ", () => {
    const { execSync } = require("child_process");
    let output = "";
    try {
      output = execSync('grep -r --include="*.ts" "FEATURE_JOBS_BULLMQ" src/', {
        encoding: "utf8",
      });
    } catch {
      // grep exit code 1 = no matches — the expected success path.
      output = "";
    }
    expect(output.trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 5. jobs.module.ts throws when REDIS_URL is missing at module init (non-test)
// ---------------------------------------------------------------------------

describe("Story · BullMQ-only — REDIS_URL required at startup in non-test env", () => {
  it("jobs.module.ts source contains a REDIS_URL guard that throws outside test runner", () => {
    const src = readFileSync("src/core/jobs/jobs.module.ts", "utf8");
    // The guard must throw when REDIS_URL is absent and not running under Vitest.
    expect(src).toContain("REDIS_URL");
    expect(src).toContain("throw new Error");
    // The guard must be bypassed in the Vitest runner so e2e specs still work.
    expect(src).toContain("VITEST");
  });
});

// ---------------------------------------------------------------------------
// 6. BullMQ cleanup planner still works (regression guard)
// ---------------------------------------------------------------------------

describe("Story · BullMQ cron-repeat plan", () => {
  it("buildBullMQCleanupJobPlan() returns a repeat config with cron + jobId", async () => {
    const { buildBullMQCleanupJobPlan } =
      await import("../../src/core/jobs/bullmq-cleanup-job-planner.js");
    const plan = buildBullMQCleanupJobPlan({ kind: "throttler" });
    expect(plan.queueName).toMatch(/throttler/);
    expect(plan.repeatPattern).toMatch(/^\d+ \* \* \* \*$/);
    expect(plan.jobId).toMatch(/throttler/);
  });

  it("buildBullMQCleanupJobPlan() handles all four kinds", async () => {
    const { buildBullMQCleanupJobPlan } =
      await import("../../src/core/jobs/bullmq-cleanup-job-planner.js");
    const kinds = ["throttler", "idempotency", "verification", "geoip"] as const;
    for (const kind of kinds) {
      const plan = buildBullMQCleanupJobPlan({ kind });
      expect(plan.queueName).toBeDefined();
      expect(plan.repeatPattern).toBeDefined();
      expect(plan.jobId).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. M1 fix: drain() returns promptly on a stopped queue with pending jobs
// ---------------------------------------------------------------------------

describe("Story · InProcessQueue.drain() returns when queue is stopped (M1 fix)", () => {
  it("drain() resolves immediately when queue.stop() is called before drain()", async () => {
    const { BullMQJobQueue } = await import("../../src/core/jobs/bullmq-job-queue.js");

    const queue = new BullMQJobQueue(null); // null redis → in-process fallback
    // Register a handler that never resolves — simulates a stuck job.
    // Without the M1 fix, drain() would loop forever waiting for this.
    queue.register("blocked", () => new Promise<void>(() => {}));
    await queue.start();

    // Stop the queue so running=false — no further processing
    await queue.stop();

    // Enqueue a job that won't be processed
    await queue.enqueue("blocked", {});

    // drain() must return rather than hanging forever
    await expect(queue.drain()).resolves.toBeUndefined();
  });
});
