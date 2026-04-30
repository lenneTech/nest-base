import { describe, expect, it } from "vitest";

import { InMemoryJobQueue } from "../../src/core/jobs/job-queue.js";

/**
 * Story · Job-Queue history (dashboard substrate).
 *
 * The Jobs-Dashboard needs to enumerate every job — pending, running,
 * completed, failed — with timestamps and the original payload. The
 * legacy `jobResult(id)` only exposes the terminal status, so the
 * dashboard would have to rebuild the timeline itself.
 *
 * Story:
 *   - `listJobs()` returns one record per enqueued job
 *   - records carry id, name, state, attempt, payload, createdAt,
 *     startedAt (once active), completedAt + state transitions, and
 *     errorMessage on failure
 *   - records are returned newest-first so the UI can render the
 *     latest activity at the top
 *   - `getAggregates()` returns the dashboard snapshot computed from
 *     the same record list
 *   - listing supports `state` and `name` filters and a `limit` cap
 *   - `retry(id)` re-enqueues a failed job, returning the new id;
 *     the original record stays in the history with `attempt = 1`
 *     and the new one carries `attempt = 2`
 */
describe("Story · Job-Queue history", () => {
  it("listJobs() returns one record per enqueued job with createdAt + payload", async () => {
    const queue = new InMemoryJobQueue();
    queue.register("ping", async () => {});
    await queue.start();
    await queue.enqueue("ping", { who: "alice" });
    await queue.enqueue("ping", { who: "bob" });
    await queue.drain();
    const records = queue.listJobs();
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.id).toMatch(/.+/);
      expect(record.name).toBe("ping");
      expect(record.state).toBe("completed");
      expect(record.attempt).toBe(1);
      expect(typeof record.createdAt).toBe("number");
      expect(typeof record.startedAt).toBe("number");
      expect(typeof record.completedAt).toBe("number");
    }
    const payloads = records.map((r) => (r.payload as { who: string }).who).sort();
    expect(payloads).toEqual(["alice", "bob"]);
    await queue.stop();
  });

  it("listJobs() returns newest-first ordering", async () => {
    const queue = new InMemoryJobQueue();
    queue.register("ping", async () => {});
    await queue.start();
    const a = await queue.enqueue("ping", { n: 1 });
    const b = await queue.enqueue("ping", { n: 2 });
    const c = await queue.enqueue("ping", { n: 3 });
    await queue.drain();
    const ids = queue.listJobs().map((r) => r.id);
    expect(ids).toEqual([c, b, a]);
    await queue.stop();
  });

  it("captures error message + stack on failed jobs", async () => {
    const queue = new InMemoryJobQueue();
    queue.register("boom", async () => {
      throw new Error("kaboom");
    });
    await queue.start();
    const id = await queue.enqueue("boom", {});
    await queue.drain();
    const record = queue.listJobs().find((r) => r.id === id);
    expect(record).toBeDefined();
    expect(record!.state).toBe("failed");
    expect(record!.errorMessage).toContain("kaboom");
    expect(record!.errorStack).toBeTruthy();
    await queue.stop();
  });

  it("filters by state and by queue name", async () => {
    const queue = new InMemoryJobQueue();
    queue.register("ok", async () => {});
    queue.register("bad", async () => {
      throw new Error("nope");
    });
    await queue.start();
    await queue.enqueue("ok", {});
    await queue.enqueue("ok", {});
    await queue.enqueue("bad", {});
    await queue.drain();
    expect(queue.listJobs({ state: "completed" })).toHaveLength(2);
    expect(queue.listJobs({ state: "failed" })).toHaveLength(1);
    expect(queue.listJobs({ name: "ok" })).toHaveLength(2);
    expect(queue.listJobs({ name: "bad" })).toHaveLength(1);
    await queue.stop();
  });

  it("respects the limit cap", async () => {
    const queue = new InMemoryJobQueue();
    queue.register("ping", async () => {});
    await queue.start();
    for (let i = 0; i < 5; i++) await queue.enqueue("ping", { i });
    await queue.drain();
    expect(queue.listJobs({ limit: 2 })).toHaveLength(2);
    expect(queue.listJobs({ limit: 100 })).toHaveLength(5);
    await queue.stop();
  });

  it("getAggregates() returns the dashboard snapshot built from listJobs()", async () => {
    const queue = new InMemoryJobQueue();
    queue.register("ok", async () => {});
    queue.register("bad", async () => {
      throw new Error("nope");
    });
    await queue.start();
    await queue.enqueue("ok", {});
    await queue.enqueue("ok", {});
    await queue.enqueue("bad", {});
    await queue.drain();
    const snapshot = queue.getAggregates();
    expect(snapshot.totalJobs).toBe(3);
    expect(snapshot.totals.completed).toBe(2);
    expect(snapshot.totals.failed).toBe(1);
    expect(snapshot.queues).toHaveLength(2);
    expect(snapshot.failureRate).toBeCloseTo(1 / 3, 5);
    await queue.stop();
  });

  it("retry(id) re-enqueues a failed job and bumps the attempt counter", async () => {
    const queue = new InMemoryJobQueue();
    let attempts = 0;
    queue.register("flaky", async () => {
      attempts++;
      if (attempts === 1) throw new Error("first try");
    });
    await queue.start();
    const original = await queue.enqueue("flaky", { run: 1 });
    await queue.drain();
    expect(queue.listJobs().find((r) => r.id === original)!.state).toBe("failed");

    const retryId = await queue.retry(original);
    expect(retryId).not.toBe(original);
    await queue.drain();
    const retried = queue.listJobs().find((r) => r.id === retryId);
    expect(retried).toBeDefined();
    expect(retried!.state).toBe("completed");
    expect(retried!.attempt).toBe(2);
    expect(retried!.payload).toEqual({ run: 1 });

    // Original record stays as-is in history.
    expect(queue.listJobs().find((r) => r.id === original)!.attempt).toBe(1);
    await queue.stop();
  });

  it("retry(id) throws when the job id is unknown", async () => {
    const queue = new InMemoryJobQueue();
    await queue.start();
    await expect(queue.retry("does-not-exist")).rejects.toThrow();
    await queue.stop();
  });

  it("retry(id) only works on failed jobs", async () => {
    const queue = new InMemoryJobQueue();
    queue.register("ok", async () => {});
    await queue.start();
    const id = await queue.enqueue("ok", {});
    await queue.drain();
    await expect(queue.retry(id)).rejects.toThrow();
    await queue.stop();
  });

  it("getJob(id) returns the record for inspection (drawer detail view)", async () => {
    const queue = new InMemoryJobQueue();
    queue.register("ok", async () => {});
    await queue.start();
    const id = await queue.enqueue("ok", { hello: "world" });
    await queue.drain();
    const record = queue.getJob(id);
    expect(record).toBeDefined();
    expect(record!.id).toBe(id);
    expect(record!.payload).toEqual({ hello: "world" });
    expect(queue.getJob("missing")).toBeUndefined();
    await queue.stop();
  });
});
