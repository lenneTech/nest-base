import { describe, expect, it } from "vitest";

import { BullMQJobQueue } from "../../src/core/jobs/bullmq-job-queue.js";

/**
 * Story · BullMQJobQueue lifecycle (Fix #10).
 *
 * Covers the four end-to-end flows using `BullMQJobQueue(null)` —
 * which activates the in-process `InProcessQueue` fallback. No live
 * Redis required; these tests run in CI without a Redis service container.
 *
 * Scenarios:
 *  1. Enqueue → drain → handler called with correct payload
 *  2. Failed job appears in listJobs() with state=failed + errorMessage
 *  3. retry(id) re-runs the handler and increments attempt to 2
 *  4. getJob(id) returns the correct record after completion
 */

describe("Story · BullMQJobQueue lifecycle — in-process queue (null Redis)", () => {
  // -------------------------------------------------------------------------
  // 1. Enqueue → drain → handler called with correct payload
  // -------------------------------------------------------------------------

  it("enqueue → drain: handler is invoked with the exact payload", async () => {
    const queue = new BullMQJobQueue(null);
    await queue.start();

    const received: unknown[] = [];
    queue.register("greet", async (payload) => {
      received.push(payload);
    });

    const id = await queue.enqueue("greet", { name: "Alice" });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    await queue.drain();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ name: "Alice" });

    await queue.stop();
  });

  // -------------------------------------------------------------------------
  // 2. Failed job appears in listJobs() with state=failed + errorMessage
  // -------------------------------------------------------------------------

  it("failed handler: job appears in listJobs() with state=failed and errorMessage", async () => {
    const queue = new BullMQJobQueue(null);
    await queue.start();

    queue.register("boom", async () => {
      throw new Error("intentional failure");
    });

    const id = await queue.enqueue("boom", { trigger: "test" });
    await queue.drain();

    const jobs = await queue.listJobs();
    const record = jobs.find((j) => j.id === id);

    expect(record).toBeDefined();
    expect(record?.state).toBe("failed");
    expect(record?.errorMessage).toContain("intentional failure");

    await queue.stop();
  });

  // -------------------------------------------------------------------------
  // 3. retry(id) re-runs handler and increments attempt to 2
  // -------------------------------------------------------------------------

  it("retry: re-enqueues the failed job and increments attempt counter to 2", async () => {
    const queue = new BullMQJobQueue(null);
    await queue.start();

    const attempts: number[] = [];

    queue.register("flaky", async () => {
      // Fail on attempt 1, succeed on attempt 2 — track call count
      // (cannot read attempt mid-flight from inside the handler)
      attempts.push(attempts.length + 1);
      if (attempts.length === 1) {
        throw new Error("first attempt fails");
      }
    });

    const originalId = await queue.enqueue("flaky", { x: 1 });
    await queue.drain();

    // Confirm original job is failed
    const failedRecord = await queue.getJob(originalId);
    expect(failedRecord?.state).toBe("failed");

    // Retry — should re-run the handler
    const newId = await queue.retry(originalId);
    expect(typeof newId).toBe("string");
    expect(newId).not.toBe(originalId);

    await queue.drain();

    // New job should be completed; attempt should be 2 (1-indexed: first retry)
    const retryRecord = await queue.getJob(newId);
    expect(retryRecord?.state).toBe("completed");
    // The in-process queue passes attemptsMade=record.attempt from the original;
    // attempt on the retry record is original.attempt + 1 = 2.
    expect(retryRecord?.attempt).toBe(2);

    await queue.stop();
  });

  // -------------------------------------------------------------------------
  // 4. getJob(id) returns the correct record after completion
  // -------------------------------------------------------------------------

  it("getJob: returns the full record with correct payload after completion", async () => {
    const queue = new BullMQJobQueue(null);
    await queue.start();

    queue.register("complete-me", async () => {
      // Successful handler — does nothing
    });

    const payload = { userId: "u-123", action: "cleanup" };
    const id = await queue.enqueue("complete-me", payload);
    await queue.drain();

    const record = await queue.getJob(id);

    expect(record).toBeDefined();
    expect(record?.id).toBe(id);
    expect(record?.state).toBe("completed");
    expect(record?.payload).toEqual(payload);
    expect(record?.name).toBe("complete-me");

    await queue.stop();
  });

  // -------------------------------------------------------------------------
  // 5. InProcessQueue eviction: records map stays under 2000 after >2000 jobs
  // -------------------------------------------------------------------------

  it("eviction: records map stays below 2000 entries after processing 2001 jobs (MIN-3)", async () => {
    const queue = new BullMQJobQueue(null);
    await queue.start();

    queue.register("bulk", async () => {
      // Fast no-op handler so the queue drains quickly
    });

    // Enqueue 2001 jobs — enough to trigger the eviction threshold (2000).
    const COUNT = 2001;
    for (let i = 0; i < COUNT; i++) {
      await queue.enqueue("bulk", { index: i });
    }
    await queue.drain();

    // After draining, listJobs() should return fewer than 2000 records because
    // the eviction pass removed the oldest completed entries.
    const allJobs = await queue.listJobs();
    expect(allJobs.length).toBeLessThan(2000);

    await queue.stop();
  });
});
