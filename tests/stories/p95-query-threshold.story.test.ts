import { describe, expect, it } from "vitest";

import {
  BAD_THRESHOLD_MS,
  QueryBuffer,
  WARN_THRESHOLD_MS,
} from "../../src/core/dx/query-buffer.js";

/**
 * Story · p95 Prisma query threshold (SC.PERF.04).
 *
 * The PRD's `SC.PERF.04` caps p95 Prisma query duration at 200ms. The
 * query-buffer (CF.OBS.09 + CF.OBS.10) implements the threshold via
 * `BAD_THRESHOLD_MS = 200`; any query above that threshold counts
 * toward the `summary().badCount` (and surfaces as red in the
 * /hub/queries page).
 *
 * This slice locks the threshold value and verifies the summary
 * counts violations correctly. Live p95 enforcement happens at
 * runtime against real Prisma calls — the planner here owns the
 * correctness of the violation classification logic.
 */
describe("Story · p95 Prisma query threshold (SC.PERF.04)", () => {
  it("BAD_THRESHOLD_MS equals the PRD-mandated 200ms cap", () => {
    expect(BAD_THRESHOLD_MS).toBe(200);
  });

  it("WARN_THRESHOLD_MS provides an early warning at 50ms", () => {
    expect(WARN_THRESHOLD_MS).toBe(50);
  });

  it("counts a query > 200ms toward badCount", () => {
    const buffer = new QueryBuffer();
    buffer.record({
      sql: "SELECT * FROM users",
      durationMs: 250,
      startedAtMs: 1_000_000,
      requestId: "req-1",
    });
    const summary = buffer.summary();
    expect(summary.badCount).toBe(1);
    expect(summary.warnCount).toBe(0);
  });

  it("counts a query in the 50-200ms band toward warnCount, not badCount", () => {
    const buffer = new QueryBuffer();
    buffer.record({
      sql: "SELECT * FROM users",
      durationMs: 100,
      startedAtMs: 1_000_000,
      requestId: "req-1",
    });
    const summary = buffer.summary();
    expect(summary.warnCount).toBe(1);
    expect(summary.badCount).toBe(0);
  });

  it("counts a fast query (< 50ms) toward neither warn nor bad", () => {
    const buffer = new QueryBuffer();
    buffer.record({
      sql: "SELECT * FROM users WHERE id = 1",
      durationMs: 10,
      startedAtMs: 1_000_000,
      requestId: "req-1",
    });
    const summary = buffer.summary();
    expect(summary.warnCount).toBe(0);
    expect(summary.badCount).toBe(0);
  });

  it("p95 well under 200ms when all queries are fast (PRD budget headroom)", () => {
    const buffer = new QueryBuffer();
    // Simulate 100 fast queries.
    for (let i = 0; i < 100; i++) {
      buffer.record({
        sql: "SELECT * FROM users WHERE id = $1",
        durationMs: 5 + (i % 10), // 5-14ms range
        startedAtMs: 1_000_000 + i,
        requestId: `req-${i}`,
      });
    }
    const durations = buffer
      .recent()
      .map((q) => q.durationMs)
      .sort((a, b) => a - b);
    const p95Index = Math.floor(durations.length * 0.95);
    const p95 = durations[p95Index]!;
    // p95 across the simulated load is ~14ms — far below the 200ms cap.
    expect(p95).toBeLessThan(BAD_THRESHOLD_MS);
  });
});
