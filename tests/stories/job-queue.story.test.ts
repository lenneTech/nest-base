import { describe, expect, it } from "vitest";

import {
  InMemoryJobQueue,
  JobHandlerNotRegisteredError,
  type JobHandler,
} from "../../src/core/jobs/job-queue.js";

/**
 * Story · Job-Queue + Worker.
 *
 * pg-boss in production; the unit suite uses an in-memory queue
 * with the same surface so the worker code is tested without a DB.
 *
 * Surface:
 *   - register(jobName, handler) — declare a worker
 *   - enqueue(jobName, payload)  — schedule work
 *   - start() / stop()           — runtime control
 *   - drain()                    — test-only helper (await empty)
 */
describe("Story · Job-Queue", () => {
  it("enqueue() runs registered handlers with the payload after start()", async () => {
    const queue = new InMemoryJobQueue();
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

  it("jobs queued before start() run after start()", async () => {
    const queue = new InMemoryJobQueue();
    const seen: number[] = [];
    queue.register("count", async (payload: { n: number }) => {
      seen.push(payload.n);
    });
    await queue.enqueue("count", { n: 1 });
    await queue.enqueue("count", { n: 2 });
    await queue.start();
    await queue.drain();
    expect(seen).toEqual([1, 2]);
    await queue.stop();
  });

  it("enqueue() throws when no handler is registered for the name", async () => {
    const queue = new InMemoryJobQueue();
    await queue.start();
    await expect(queue.enqueue("unknown", {})).rejects.toThrow(JobHandlerNotRegisteredError);
    await queue.stop();
  });

  it("different job names hit their own handlers", async () => {
    const queue = new InMemoryJobQueue();
    const seen: string[] = [];
    queue.register("a", async () => {
      seen.push("a-ran");
    });
    queue.register("b", async () => {
      seen.push("b-ran");
    });
    await queue.start();
    await queue.enqueue("a", {});
    await queue.enqueue("b", {});
    await queue.drain();
    expect(seen.sort()).toEqual(["a-ran", "b-ran"]);
    await queue.stop();
  });

  it("handler errors are captured and exposed via the job result", async () => {
    const queue = new InMemoryJobQueue();
    queue.register("boom", async () => {
      throw new Error("kaboom");
    });
    await queue.start();
    const id = await queue.enqueue("boom", {});
    await queue.drain();
    const result = queue.jobResult(id);
    expect(result?.status).toBe("failed");
    expect(result?.error?.message).toContain("kaboom");
    await queue.stop();
  });

  it("successful jobs end up with status=completed", async () => {
    const queue = new InMemoryJobQueue();
    queue.register("ok", async () => {});
    await queue.start();
    const id = await queue.enqueue("ok", {});
    await queue.drain();
    expect(queue.jobResult(id)?.status).toBe("completed");
    await queue.stop();
  });

  it("start() is idempotent — second call does not double-process", async () => {
    const queue = new InMemoryJobQueue();
    let count = 0;
    queue.register("once", async () => {
      count++;
    });
    await queue.start();
    await queue.start();
    await queue.enqueue("once", {});
    await queue.drain();
    expect(count).toBe(1);
    await queue.stop();
  });

  it("jobs enqueued after stop() do not run until start() again", async () => {
    const queue = new InMemoryJobQueue();
    let count = 0;
    queue.register("count", async () => {
      count++;
    });
    await queue.start();
    await queue.enqueue("count", {});
    await queue.drain();
    await queue.stop();
    await queue.enqueue("count", {});
    expect(count).toBe(1);
    await queue.start();
    await queue.drain();
    expect(count).toBe(2);
    await queue.stop();
  });
});
