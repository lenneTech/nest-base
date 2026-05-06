import { describe, expect, it, vi } from "vitest";

import { PgBossJobQueue } from "../../src/core/jobs/pg-boss-job-queue.js";

/**
 * Story · pg-boss-backed JobQueue (CF.JOBS.01 closure — iter-215).
 *
 * Iter-205's `docs/prd-deviations.md` documented CF.JOBS.01: the
 * `JobQueueService` extended `InMemoryJobQueue` so process restart
 * dropped every in-flight enqueue. Iter-215 layers pg-boss on top:
 *   - `enqueue` writes to the in-process queue AND `boss.send()`
 *     (durability)
 *   - `register` ALSO calls `boss.work()` so a restarting process
 *     replays unacknowledged jobs
 *   - The replay worker dedupes against the in-process dispatched
 *     set so concurrent in-process + replay execution doesn't
 *     double-fire
 *
 * Test-mode (`boss === null`) falls through to pure InMemoryJobQueue
 * behaviour. The pg-boss surface is exercised via a fake that captures
 * `send()` and `work()` calls.
 */
describe("Story · PgBossJobQueue (CF.JOBS.01 — iter-215)", () => {
  function fakeBoss() {
    const send = vi.fn().mockResolvedValue("boss-id-1");
    const workHandlers = new Map<string, (...args: unknown[]) => Promise<unknown> | unknown>();
    const work = vi
      .fn()
      .mockImplementation(
        async (name: string, handler: (...args: unknown[]) => Promise<unknown> | unknown) => {
          workHandlers.set(name, handler);
        },
      );
    return { send, work, workHandlers };
  }

  it("with boss=null behaves identically to InMemoryJobQueue (no durability)", async () => {
    const queue = new PgBossJobQueue(null);
    queue.register("test", async () => {});
    queue.start();
    const id = await queue.enqueue("test", { foo: 1 });
    expect(typeof id).toBe("string");
    await queue.drain();
    expect(queue.jobResult(id)?.status).toBe("completed");
    queue.stop();
  });

  it("enqueue writes to boss.send AFTER the in-process record is created", async () => {
    const boss = fakeBoss();
    const queue = new PgBossJobQueue(boss);
    queue.register("test", async () => {});
    queue.start();
    const id = await queue.enqueue("test", { hello: "world" });
    expect(boss.send).toHaveBeenCalledTimes(1);
    expect(boss.send).toHaveBeenCalledWith("test", { jobId: id, payload: { hello: "world" } });
    await queue.drain();
    queue.stop();
  });

  it("register installs a pg-boss worker that dispatches to the same handler on replay", async () => {
    const boss = fakeBoss();
    const queue = new PgBossJobQueue(boss);
    const handlerCalls: unknown[] = [];
    queue.register("test", async (payload) => {
      handlerCalls.push(payload);
    });
    // Wait for the async work() registration to settle.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(boss.work).toHaveBeenCalledTimes(1);
    expect(boss.work).toHaveBeenCalledWith("test", expect.any(Function));

    // Simulate pg-boss replaying a job after a hypothetical restart
    // (jobId NOT in the dispatchedInProcess set).
    const replay = boss.workHandlers.get("test");
    if (!replay) throw new Error("expected work handler to be registered");
    await replay([{ id: "boss-row-1", data: { jobId: "replayed-job", payload: { x: 42 } } }]);
    expect(handlerCalls).toEqual([{ x: 42 }]);
  });

  it("replay worker DEDUPES against in-process dispatched ids (no double-fire)", async () => {
    const boss = fakeBoss();
    const queue = new PgBossJobQueue(boss);
    const handlerCalls: unknown[] = [];
    queue.register("test", async (payload) => {
      handlerCalls.push(payload);
    });
    queue.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 1. Enqueue normally — handler fires once in-process.
    const id = await queue.enqueue("test", { round: "in-process" });
    await queue.drain();
    expect(handlerCalls).toEqual([{ round: "in-process" }]);

    // 2. Simulate pg-boss replaying the SAME jobId — should be skipped.
    const replay = boss.workHandlers.get("test");
    if (!replay) throw new Error("expected work handler to be registered");
    await replay([{ id: "boss-row-1", data: { jobId: id, payload: { round: "replay" } } }]);
    // Handler still has only the in-process call.
    expect(handlerCalls).toEqual([{ round: "in-process" }]);
    queue.stop();
  });

  it("when boss.send rejects, the in-process job still completes (graceful degradation)", async () => {
    const boss = fakeBoss();
    boss.send.mockRejectedValueOnce(new Error("connection lost"));
    const queue = new PgBossJobQueue(boss);
    queue.register("test", async () => {});
    queue.start();
    const id = await queue.enqueue("test", null);
    expect(typeof id).toBe("string");
    await queue.drain();
    expect(queue.jobResult(id)?.status).toBe("completed");
    queue.stop();
  });

  it("docs/prd-deviations.md no longer lists CF.JOBS.01", async () => {
    const { readFileSync } = await import("node:fs");
    const deviationsSrc = readFileSync("docs/prd-deviations.md", "utf8");
    expect(deviationsSrc).not.toMatch(/^### CF\.JOBS\.01/m);
  });
});
