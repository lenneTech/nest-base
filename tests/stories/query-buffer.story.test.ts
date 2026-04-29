import { describe, expect, it } from "vitest";

import { QueryBuffer, normaliseSql } from "../../src/core/dx/query-buffer.js";

/**
 * Story · Query buffer.
 *
 * In-memory ring buffer for Prisma query events. Same shape as
 * `TraceBuffer` — capacity-bounded, surfaces recent records with
 * a summary (count, slowest, top-N most frequent SQL templates).
 *
 * The "frequent SQL templates" view is the cheap N+1 detector:
 * if the same parametrised query template fires 50 times in one
 * request, that's a strong signal someone added a missing
 * `include:` and is round-tripping per row.
 */
describe("Story · QueryBuffer", () => {
  it("records and replays queries in chronological order", () => {
    const buf = new QueryBuffer({ capacity: 100 });
    buf.record({
      sql: "SELECT * FROM users WHERE id = $1",
      durationMs: 5,
      startedAtMs: 1000,
    });
    buf.record({
      sql: "SELECT * FROM tenants WHERE id = $1",
      durationMs: 12,
      startedAtMs: 2000,
    });
    expect(buf.recent().map((q) => q.sql)).toEqual([
      "SELECT * FROM users WHERE id = $1",
      "SELECT * FROM tenants WHERE id = $1",
    ]);
  });

  it("evicts oldest entries when capacity is exceeded", () => {
    const buf = new QueryBuffer({ capacity: 3 });
    for (let i = 0; i < 5; i++) {
      buf.record({ sql: `Q${i}`, durationMs: 1, startedAtMs: i });
    }
    expect(buf.recent().map((q) => q.sql)).toEqual(["Q2", "Q3", "Q4"]);
  });

  it("computes summary counts (total, slowest, slow-threshold breaches)", () => {
    const buf = new QueryBuffer({ capacity: 10 });
    const durations = [3, 80, 12, 250, 5];
    for (const ms of durations) buf.record({ sql: "SELECT 1", durationMs: ms, startedAtMs: 0 });
    const summary = buf.summary();
    expect(summary.total).toBe(5);
    expect(summary.slowestMs).toBe(250);
    expect(summary.warnCount).toBe(1); // > 50 ms ⇒ warn
    expect(summary.badCount).toBe(1); // > 200 ms ⇒ bad
  });

  it("returns the slowest N for the dashboard tile", () => {
    const buf = new QueryBuffer({ capacity: 10 });
    [10, 50, 200, 30, 5].forEach((ms, i) =>
      buf.record({ sql: `Q${i}`, durationMs: ms, startedAtMs: i }),
    );
    const slowest = buf.slowest(3);
    expect(slowest.map((q) => q.durationMs)).toEqual([200, 50, 30]);
  });

  it("returns top-N frequent SQL templates (rough N+1 indicator)", () => {
    const buf = new QueryBuffer({ capacity: 100 });
    // 5 calls to the same template (with varying params), 2 to another, 1 to a third
    for (let i = 0; i < 5; i++) {
      buf.record({
        sql: `SELECT * FROM users WHERE id = '${i}'`,
        durationMs: 2,
        startedAtMs: i,
      });
    }
    for (let i = 0; i < 2; i++) {
      buf.record({
        sql: `SELECT * FROM tenants WHERE name = 'foo'`,
        durationMs: 4,
        startedAtMs: i + 100,
      });
    }
    buf.record({ sql: "SELECT 1", durationMs: 1, startedAtMs: 200 });
    const top = buf.topTemplates(3);
    expect(top[0]).toMatchObject({ count: 5 });
    expect(top[0]?.template).toContain("users");
    expect(top[1]).toMatchObject({ count: 2 });
  });

  describe("normaliseSql (template extraction for grouping)", () => {
    it("strips numeric and string literals so they collapse into one template", () => {
      expect(normaliseSql("SELECT * FROM users WHERE id = 42")).toBe(
        normaliseSql("SELECT * FROM users WHERE id = 99"),
      );
      expect(normaliseSql("SELECT * FROM users WHERE name = 'alice'")).toBe(
        normaliseSql("SELECT * FROM users WHERE name = 'bob'"),
      );
    });

    it("collapses whitespace so formatting differences don't fragment templates", () => {
      expect(normaliseSql("SELECT *\n  FROM users")).toBe(normaliseSql("SELECT * FROM users"));
    });

    it("preserves the parametrised form ($1, $2, …) untouched", () => {
      expect(normaliseSql("SELECT * FROM x WHERE id = $1")).toContain("$1");
    });
  });

  it("clear() empties the buffer", () => {
    const buf = new QueryBuffer({ capacity: 10 });
    buf.record({ sql: "Q", durationMs: 1, startedAtMs: 0 });
    buf.clear();
    expect(buf.recent()).toEqual([]);
  });
});
