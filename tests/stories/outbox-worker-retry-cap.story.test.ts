import { describe, expect, it } from "vitest";

import { OutboxWorker } from "../../src/core/outbox/outbox-worker.js";
import type { OutboxDispatcher } from "../../src/core/outbox/outbox-worker.js";
import type { OutboxEntry, OutboxStorage } from "../../src/core/outbox/outbox.js";

/**
 * Story · OutboxWorker retry-cap (Fix #9).
 *
 * When `maxAttempts` is set, entries that have failed that many times
 * are dead-lettered (marked processed) and never retried again.
 */

// ── Fake helpers ──────────────────────────────────────────────────────

function makeEntry(id: string): OutboxEntry {
  return {
    id,
    seq: 1,
    tenantId: "test-tenant",
    type: "test.event",
    payload: { id },
    occurredAt: new Date(),
    processedAt: null,
  };
}

interface FakeStorage extends OutboxStorage {
  pending: OutboxEntry[];
  processed: string[];
}

function makeStorage(entries: OutboxEntry[]): FakeStorage {
  const pending = [...entries];
  const processed: string[] = [];
  return {
    pending,
    processed,
    async claimBatch(limit: number): Promise<OutboxEntry[]> {
      // Return up to `limit` unprocessed entries
      return pending.filter((e) => !processed.includes(e.id)).slice(0, limit);
    },
    async markProcessed(id: string): Promise<boolean> {
      processed.push(id);
      return true;
    },
    async append(): Promise<void> {},
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Story · OutboxWorker maxAttempts retry cap", () => {
  it("entry is not retried after maxAttempts failures", async () => {
    const entry = makeEntry("entry-1");
    const storage = makeStorage([entry]);
    let dispatchCount = 0;
    const failDispatcher: OutboxDispatcher = {
      name: "fail",
      dispatch: async () => {
        dispatchCount++;
        throw new Error("fail");
      },
    };

    const worker = new OutboxWorker(storage, [failDispatcher], {
      batchSize: 10,
      maxAttempts: 3,
    });

    // Run 3 times — entry is attempted each time (counts 1, 2, 3)
    await worker.runOnce();
    await worker.runOnce();
    await worker.runOnce();
    expect(dispatchCount).toBe(3);

    // On the 4th call, the cap is hit: dead-lettered, dispatcher NOT called
    await worker.runOnce();
    expect(dispatchCount).toBe(3); // still 3 — no 4th dispatch

    // After dead-lettering, the entry is marked processed
    expect(storage.processed).toContain("entry-1");
  });

  it("entry is retried up to maxAttempts times before being dead-lettered", async () => {
    const entry = makeEntry("entry-2");
    const storage = makeStorage([entry]);
    const dispatchCalls: string[] = [];
    const failDispatcher: OutboxDispatcher = {
      name: "fail",
      dispatch: async (e) => {
        dispatchCalls.push(e.id);
        throw new Error("always fails");
      },
    };

    const worker = new OutboxWorker(storage, [failDispatcher], {
      batchSize: 10,
      maxAttempts: 2,
    });

    // Attempt 1
    await worker.runOnce();
    expect(dispatchCalls).toHaveLength(1);
    expect(storage.processed).not.toContain("entry-2");

    // Attempt 2
    await worker.runOnce();
    expect(dispatchCalls).toHaveLength(2);
    expect(storage.processed).not.toContain("entry-2");

    // Attempt 3 — hits the cap: dead-lettered, dispatcher NOT called
    await worker.runOnce();
    expect(dispatchCalls).toHaveLength(2); // still 2, not 3
    expect(storage.processed).toContain("entry-2");

    // Further calls: entry is already processed — claimBatch returns empty
    await worker.runOnce();
    expect(dispatchCalls).toHaveLength(2);
  });

  it("successful entry is not affected by maxAttempts — processed on first attempt", async () => {
    const entry = makeEntry("entry-ok");
    const storage = makeStorage([entry]);
    let dispatched = false;
    const okDispatcher: OutboxDispatcher = {
      name: "ok",
      dispatch: async () => {
        dispatched = true;
      },
    };

    const worker = new OutboxWorker(storage, [okDispatcher], {
      batchSize: 10,
      maxAttempts: 3,
    });

    const result = await worker.runOnce();
    expect(result.processed).toBe(1);
    expect(result.deadLettered).toBe(0);
    expect(dispatched).toBe(true);
    expect(storage.processed).toContain("entry-ok");
  });

  it("no maxAttempts set: entry is retried indefinitely (backwards-compat)", async () => {
    const entry = makeEntry("entry-inf");
    const storage = makeStorage([entry]);
    let calls = 0;
    const failDispatcher: OutboxDispatcher = {
      name: "fail",
      dispatch: async () => {
        calls++;
        throw new Error("fail");
      },
    };

    // No maxAttempts — default behaviour
    const worker = new OutboxWorker(storage, [failDispatcher], { batchSize: 10 });

    for (let i = 0; i < 5; i++) {
      await worker.runOnce();
    }

    // Entry is never dead-lettered — called every time
    expect(calls).toBe(5);
    expect(storage.processed).not.toContain("entry-inf");
  });
});
