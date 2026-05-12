import { describe, expect, it } from "vitest";

import {
  OutboxRecorder,
  type OutboxEntry,
  type OutboxStorage,
} from "../../src/core/outbox/outbox.js";

/**
 * Story · Outbox-Pattern.
 *
 * Atomic publish-with-persist: a domain operation writes to its own
 * tables AND inserts an outbox row in the same DB transaction. A
 * separate worker reads outbox rows in order, dispatches them
 * (webhooks / realtime / search index), and marks them processed.
 *
 * This module owns the recorder + the worker dispatch loop; the
 * Prisma binding for OutboxStorage lives next to PrismaService.
 */
describe("Story · Outbox", () => {
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
        const batch = rows.filter((r) => r.processedAt === null).slice(0, limit);
        return batch;
      },
      async markProcessed(id, processedAt) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx < 0) return false;
        rows[idx] = { ...rows[idx]!, processedAt };
        return true;
      },
    };
  }

  it("record() appends an unprocessed entry with monotonically growing seq", async () => {
    const storage = makeStorage();
    const rec = new OutboxRecorder(storage);
    const a = await rec.record({ tenantId: "t1", type: "x", payload: { v: 1 } });
    const b = await rec.record({ tenantId: "t1", type: "x", payload: { v: 2 } });
    expect(a.seq).toBeLessThan(b.seq);
    expect(a.processedAt).toBeNull();
    expect(b.processedAt).toBeNull();
    expect(storage.rows).toHaveLength(2);
  });

  it("claimBatch() returns at most `limit` unprocessed entries", async () => {
    const storage = makeStorage();
    const rec = new OutboxRecorder(storage);
    for (let i = 0; i < 5; i++) {
      await rec.record({ tenantId: "t1", type: "x", payload: { v: i } });
    }
    const batch = await storage.claimBatch(3);
    expect(batch).toHaveLength(3);
  });

  it("markProcessed() removes the entry from the next claimBatch", async () => {
    const storage = makeStorage();
    const rec = new OutboxRecorder(storage);
    const entry = await rec.record({ tenantId: "t1", type: "x", payload: {} });
    await rec.markProcessed(entry.id);
    const batch = await storage.claimBatch(10);
    expect(batch.find((e) => e.id === entry.id)).toBeUndefined();
  });

  it("record() rejects empty type", async () => {
    const rec = new OutboxRecorder(makeStorage());
    await expect(rec.record({ tenantId: "t1", type: "", payload: {} })).rejects.toThrow(/type/i);
  });

  it("runs records in insertion order (FIFO)", async () => {
    const storage = makeStorage();
    const rec = new OutboxRecorder(storage);
    await rec.record({ tenantId: "t1", type: "a", payload: {} });
    await rec.record({ tenantId: "t1", type: "b", payload: {} });
    await rec.record({ tenantId: "t1", type: "c", payload: {} });
    const batch = await storage.claimBatch(10);
    expect(batch.map((e) => e.type)).toEqual(["a", "b", "c"]);
  });

  it("seq does not restart from 1 after process restart when initSeq is called", async () => {
    // OutboxRecorder exposes initSeq(n) and OutboxModule.onModuleInit seeds it
    // from SELECT MAX(seq) so new entries after restart always have seq > max(old seq).
    const storage = makeStorage();
    const rec1 = new OutboxRecorder(storage);
    const a = await rec1.record({ tenantId: "t1", type: "x", payload: {} });
    const b = await rec1.record({ tenantId: "t1", type: "x", payload: {} });
    expect(b.seq).toBeGreaterThan(a.seq);

    // Simulate restart: new recorder instance, same storage (rows persist).
    // OutboxModule.onModuleInit would call initSeq(maxSeq + 1) here.
    const rec2 = new OutboxRecorder(storage);
    rec2.initSeq(b.seq + 1);
    const c = await rec2.record({ tenantId: "t1", type: "x", payload: {} });

    // After initSeq, the new entry must have a seq strictly greater than the
    // last entry before the simulated restart — no seq collision.
    expect(c.seq).toBeGreaterThan(b.seq);
  });
});
