import { describe, expect, it } from "vitest";

import { InMemoryOutboxStorage } from "../../src/core/outbox/outbox.module.js";
import { OutboxRecorder } from "../../src/core/outbox/outbox.js";
import { OutboxWorker, type OutboxDispatcher } from "../../src/core/outbox/outbox-worker.js";

/**
 * Story · InMemoryOutboxStorage retry behaviour.
 *
 * When a dispatcher fails, the entry must NOT be permanently stuck in the
 * `inFlight` set. A failed entry must be claimable again on the next
 * `claimBatch()` call so the worker can retry it — at-least-once semantics.
 *
 * Previously `inFlight` was never cleaned up on failure, causing entries
 * whose dispatchers threw to disappear forever (data loss silently).
 */
describe("Story · InMemoryOutboxStorage retry behaviour", () => {
  it("a failed entry is re-claimable on the next claimBatch() call", async () => {
    const storage = new InMemoryOutboxStorage();
    const recorder = new OutboxRecorder(storage);
    await recorder.record({ tenantId: "t1", type: "event.created", payload: { v: 1 } });

    let dispatchCalls = 0;
    const failing: OutboxDispatcher = {
      name: "webhook",
      async dispatch() {
        dispatchCalls++;
        throw new Error("dispatcher down");
      },
    };

    const worker = new OutboxWorker(storage, [failing], { batchSize: 10 });

    // First tick — dispatcher fails; entry must NOT be permanently lost.
    const firstTick = await worker.runOnce();
    expect(firstTick).toBe(0); // nothing marked processed

    // Second tick — the entry must be re-claimed and retried.
    const secondTick = await worker.runOnce();
    expect(secondTick).toBe(0); // still failing
    expect(dispatchCalls).toBe(2); // dispatcher was called on BOTH ticks
  });

  it("a successful entry is not re-dispatched on subsequent ticks", async () => {
    const storage = new InMemoryOutboxStorage();
    const recorder = new OutboxRecorder(storage);
    await recorder.record({ tenantId: "t1", type: "event.created", payload: {} });

    let calls = 0;
    const dispatcher: OutboxDispatcher = {
      name: "webhook",
      async dispatch() {
        calls++;
      },
    };
    const worker = new OutboxWorker(storage, [dispatcher], { batchSize: 10 });

    const first = await worker.runOnce();
    expect(first).toBe(1); // entry processed
    expect(calls).toBe(1);

    // Second tick — nothing to process.
    const second = await worker.runOnce();
    expect(second).toBe(0);
    expect(calls).toBe(1); // not called again
  });

  it("claimBatch() does not return already-processed entries", async () => {
    const storage = new InMemoryOutboxStorage();
    const recorder = new OutboxRecorder(storage);
    const entry = await recorder.record({ tenantId: "t1", type: "x", payload: {} });
    await storage.markProcessed(entry.id, new Date());

    const batch = await storage.claimBatch(10);
    expect(batch.find((e: { id: string }) => e.id === entry.id)).toBeUndefined();
  });
});
