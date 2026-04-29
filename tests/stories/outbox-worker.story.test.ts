import { describe, expect, it, vi } from "vitest";

import {
  OutboxRecorder,
  type OutboxEntry,
  type OutboxStorage,
} from "../../src/core/outbox/outbox.js";
import { OutboxWorker, type OutboxDispatcher } from "../../src/core/outbox/outbox-worker.js";

/**
 * Story · Outbox Worker (PLAN.md §28.4/#18).
 *
 * Reads claimed outbox entries in order, fans them out to every
 * registered dispatcher (webhooks / realtime / search), and marks
 * each entry processed only after every dispatcher returns. Errors
 * from one dispatcher do NOT stop sibling dispatchers — but a fully
 * failed entry stays unprocessed for the next worker tick.
 */
describe("Story · Outbox Worker", () => {
  function makeStorage(): OutboxStorage & { rows: OutboxEntry[] } {
    const rows: OutboxEntry[] = [];
    return {
      get rows() {
        return rows;
      },
      async append(entry) {
        rows.push(entry);
      },
      async claimBatch(limit) {
        return rows.filter((r) => r.processedAt === null).slice(0, limit);
      },
      async markProcessed(id, processedAt) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx < 0) return false;
        rows[idx] = { ...rows[idx]!, processedAt };
        return true;
      },
    };
  }

  it("runOnce() dispatches every claimed entry to every dispatcher", async () => {
    const storage = makeStorage();
    const recorder = new OutboxRecorder(storage);
    await recorder.record({ tenantId: "t1", type: "a", payload: { v: 1 } });
    await recorder.record({ tenantId: "t1", type: "b", payload: { v: 2 } });

    const seenWebhook: string[] = [];
    const seenRealtime: string[] = [];
    const dispatchers: OutboxDispatcher[] = [
      {
        name: "webhook",
        async dispatch(entry) {
          seenWebhook.push(entry.type);
        },
      },
      {
        name: "realtime",
        async dispatch(entry) {
          seenRealtime.push(entry.type);
        },
      },
    ];
    const worker = new OutboxWorker(storage, dispatchers, { batchSize: 10 });

    await worker.runOnce();

    expect(seenWebhook.sort()).toEqual(["a", "b"]);
    expect(seenRealtime.sort()).toEqual(["a", "b"]);
  });

  it("runOnce() marks entries processed only after every dispatcher succeeds", async () => {
    const storage = makeStorage();
    const recorder = new OutboxRecorder(storage);
    await recorder.record({ tenantId: "t1", type: "a", payload: {} });

    const worker = new OutboxWorker(storage, [{ name: "webhook", async dispatch() {} }], {
      batchSize: 10,
    });
    await worker.runOnce();

    expect(storage.rows[0]!.processedAt).toBeInstanceOf(Date);
    const second = await worker.runOnce();
    expect(second).toBe(0);
  });

  it("a failing dispatcher does not stop sibling dispatchers from running", async () => {
    const storage = makeStorage();
    const recorder = new OutboxRecorder(storage);
    await recorder.record({ tenantId: "t1", type: "a", payload: {} });

    const seenSibling: string[] = [];
    const failing: OutboxDispatcher = {
      name: "webhook",
      async dispatch() {
        throw new Error("webhook down");
      },
    };
    const sibling: OutboxDispatcher = {
      name: "realtime",
      async dispatch(entry) {
        seenSibling.push(entry.type);
      },
    };
    const worker = new OutboxWorker(storage, [failing, sibling], { batchSize: 10 });
    await worker.runOnce();

    expect(seenSibling).toEqual(["a"]);
  });

  it("a fully-failed entry stays unprocessed for the next tick", async () => {
    const storage = makeStorage();
    const recorder = new OutboxRecorder(storage);
    await recorder.record({ tenantId: "t1", type: "a", payload: {} });

    let calls = 0;
    const failing: OutboxDispatcher = {
      name: "webhook",
      async dispatch() {
        calls++;
        throw new Error("boom");
      },
    };
    const worker = new OutboxWorker(storage, [failing], { batchSize: 10 });
    await worker.runOnce();
    expect(storage.rows[0]!.processedAt).toBeNull();
    await worker.runOnce();
    expect(calls).toBe(2);
  });

  it("honors batchSize when claiming entries", async () => {
    const storage = makeStorage();
    const recorder = new OutboxRecorder(storage);
    for (let i = 0; i < 5; i++) {
      await recorder.record({ tenantId: "t1", type: `t${i}`, payload: {} });
    }
    const dispatcher: OutboxDispatcher & { calls: number } = {
      name: "d",
      calls: 0,
      async dispatch() {
        this.calls++;
      },
    };
    const worker = new OutboxWorker(storage, [dispatcher], { batchSize: 3 });
    const processed = await worker.runOnce();
    expect(processed).toBe(3);
    expect(dispatcher.calls).toBe(3);
  });

  it("runOnce() returns 0 when there are no entries to process", async () => {
    const storage = makeStorage();
    const dispatch = vi.fn();
    const worker = new OutboxWorker(storage, [{ name: "d", dispatch }], { batchSize: 5 });
    expect(await worker.runOnce()).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
