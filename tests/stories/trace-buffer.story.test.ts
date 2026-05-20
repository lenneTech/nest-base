import { describe, expect, it } from "vitest";

import { TraceBuffer, type TraceRecord } from "../../src/core/dx/trace-buffer.js";

/**
 * Story · Trace buffer.
 *
 * In-memory ring buffer that records request-level "traces" — start
 * time, duration, method/path, status, optional error. Same shape as
 * the log buffer; surfaced via `/hub/traces` so a developer can see
 * "what just happened in this dev session?" without booting a real
 * OTel pipeline.
 */
describe("Story · TraceBuffer", () => {
  it("records and returns traces in chronological order", () => {
    const buf = new TraceBuffer({ capacity: 100 });
    buf.record({
      requestId: "r-1",
      method: "GET",
      path: "/projects",
      startedAtMs: 1000,
      durationMs: 12,
      status: 200,
    });
    buf.record({
      requestId: "r-2",
      method: "POST",
      path: "/projects",
      startedAtMs: 2000,
      durationMs: 45,
      status: 201,
    });
    expect(buf.recent().map((r) => r.requestId)).toEqual(["r-1", "r-2"]);
  });

  it("evicts oldest entries when capacity is exceeded", () => {
    const buf = new TraceBuffer({ capacity: 3 });
    for (let i = 0; i < 5; i++) {
      buf.record({
        requestId: `r-${i}`,
        method: "GET",
        path: "/x",
        startedAtMs: i,
        durationMs: 1,
        status: 200,
      });
    }
    const ids = buf.recent().map((r) => r.requestId);
    expect(ids).toEqual(["r-2", "r-3", "r-4"]);
  });

  it("returns the most recent N when limit is given", () => {
    const buf = new TraceBuffer({ capacity: 100 });
    for (let i = 0; i < 10; i++) {
      buf.record({
        requestId: `r-${i}`,
        method: "GET",
        path: "/x",
        startedAtMs: i,
        durationMs: 1,
        status: 200,
      });
    }
    const last3 = buf.recent({ limit: 3 });
    expect(last3.map((r) => r.requestId)).toEqual(["r-7", "r-8", "r-9"]);
  });

  it("filters by requestId substring", () => {
    const buf = new TraceBuffer({ capacity: 100 });
    buf.record({
      requestId: "abc-123",
      method: "GET",
      path: "/x",
      startedAtMs: 0,
      durationMs: 1,
      status: 200,
    });
    buf.record({
      requestId: "def-456",
      method: "GET",
      path: "/x",
      startedAtMs: 1,
      durationMs: 1,
      status: 200,
    });
    expect(buf.recent({ requestId: "abc" })).toHaveLength(1);
    expect(buf.recent({ requestId: "abc" })[0]?.requestId).toBe("abc-123");
  });

  it("preserves error metadata when supplied", () => {
    const buf = new TraceBuffer({ capacity: 10 });
    buf.record({
      requestId: "r-err",
      method: "POST",
      path: "/projects",
      startedAtMs: 0,
      durationMs: 8,
      status: 500,
      error: { name: "Error", message: "kaboom" },
    });
    const record = buf.recent()[0] as TraceRecord;
    expect(record.error).toEqual({ name: "Error", message: "kaboom" });
    expect(record.status).toBe(500);
  });

  it("computes a summary (count, slowest, error rate)", () => {
    const buf = new TraceBuffer({ capacity: 10 });
    const traces = [
      { status: 200, durationMs: 10 },
      { status: 200, durationMs: 50 },
      { status: 500, durationMs: 20 },
      { status: 404, durationMs: 5 },
    ];
    traces.forEach((t, i) => {
      buf.record({
        requestId: `r-${i}`,
        method: "GET",
        path: "/x",
        startedAtMs: i,
        durationMs: t.durationMs,
        status: t.status,
      });
    });
    const summary = buf.summary();
    expect(summary.total).toBe(4);
    expect(summary.errors).toBe(1); // status 500 → server error
    expect(summary.slowestMs).toBe(50);
  });

  it("clear() empties the buffer", () => {
    const buf = new TraceBuffer({ capacity: 10 });
    buf.record({
      requestId: "r-1",
      method: "GET",
      path: "/x",
      startedAtMs: 0,
      durationMs: 1,
      status: 200,
    });
    buf.clear();
    expect(buf.recent()).toEqual([]);
  });

  describe("seq + since() for incremental polling", () => {
    // Why: the /hub/traces page polls /hub/traces.json every 2 s for
    // new traces. To avoid re-sending the entire buffer on every
    // tick, each record carries a monotonic `seq` so the client can
    // ask "give me everything after the last one I saw".
    it("assigns a monotonic seq to each recorded trace", () => {
      const buf = new TraceBuffer({ capacity: 100 });
      const seqs: number[] = [];
      for (let i = 0; i < 5; i++) {
        buf.record({
          requestId: `r-${i}`,
          method: "GET",
          path: "/x",
          startedAtMs: i,
          durationMs: 1,
          status: 200,
        });
      }
      for (const r of buf.recent()) seqs.push(r.seq as number);
      expect(seqs).toEqual([1, 2, 3, 4, 5]);
    });

    it("since(seq) returns only records strictly after the cursor", () => {
      const buf = new TraceBuffer({ capacity: 100 });
      for (let i = 0; i < 5; i++) {
        buf.record({
          requestId: `r-${i}`,
          method: "GET",
          path: "/x",
          startedAtMs: i,
          durationMs: 1,
          status: 200,
        });
      }
      const newer = buf.since(2);
      expect(newer.map((r) => r.requestId)).toEqual(["r-2", "r-3", "r-4"]);
    });

    it("since(0) returns everything (initial-load shortcut)", () => {
      const buf = new TraceBuffer({ capacity: 100 });
      buf.record({
        requestId: "r-1",
        method: "GET",
        path: "/x",
        startedAtMs: 0,
        durationMs: 1,
        status: 200,
      });
      expect(buf.since(0)).toHaveLength(1);
    });

    it("since() is empty when no traces are newer than the cursor", () => {
      const buf = new TraceBuffer({ capacity: 100 });
      buf.record({
        requestId: "r-1",
        method: "GET",
        path: "/x",
        startedAtMs: 0,
        durationMs: 1,
        status: 200,
      });
      expect(buf.since(99)).toEqual([]);
    });
  });
});
