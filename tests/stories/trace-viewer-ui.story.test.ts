import { describe, expect, it } from "vitest";

import { renderTraceViewerPage } from "../../src/core/dx/trace-viewer-ui.js";
import type { TraceRecord, TraceSummary } from "../../src/core/dx/trace-buffer.js";

function trace(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    requestId: "abc-123",
    method: "GET",
    path: "/projects",
    startedAtMs: 1_777_000_000_000,
    durationMs: 12,
    status: 200,
    seq: 1,
    ...overrides,
  };
}

const baseSummary: TraceSummary = { total: 0, errors: 0, slowestMs: 0 };

describe("Story · Trace-Viewer UI", () => {
  it("renders newest-first (most recent at the top of the table)", () => {
    const html = renderTraceViewerPage({
      traces: [
        trace({ requestId: "old-1", path: "/old", seq: 1 }),
        trace({ requestId: "new-2", path: "/new", seq: 2 }),
      ],
      summary: baseSummary,
    });
    const oldIdx = html.indexOf("/old");
    const newIdx = html.indexOf("/new");
    expect(newIdx).toBeGreaterThan(0);
    expect(newIdx).toBeLessThan(oldIdx);
  });

  describe("Height-bounded scroll container (terminal-style follow-tail)", () => {
    it("wraps the table in a height-bound scroll container", () => {
      const html = renderTraceViewerPage({ traces: [trace()], summary: baseSummary });
      expect(html).toContain("tv-scroll");
      expect(html).toMatch(/\.tv-scroll[^}]*max-height:/);
      // Use dvh for mobile-safe viewport math, same pattern as /dev/logs.
      expect(html).toMatch(/100dvh/);
    });

    it("makes the <thead> sticky so the column labels stay visible while scrolling", () => {
      const html = renderTraceViewerPage({ traces: [trace()], summary: baseSummary });
      expect(html).toMatch(/\.tv-table\s+thead[^}]*position:\s*sticky/);
    });
  });

  describe("Live polling", () => {
    it("ships a polling script with the cursor seeded from the latest trace", () => {
      const html = renderTraceViewerPage({
        traces: [trace({ seq: 7 }), trace({ seq: 12 })],
        summary: baseSummary,
      });
      // Selector for the scroll container, polling interval, cursor-aware fetch.
      expect(html).toContain("[data-tv-tbody]");
      expect(html).toMatch(/\/dev\/traces\.json\?since=/);
      // Cursor must start at the highest seq we know about.
      expect(html).toMatch(/cursor\s*=\s*12/);
    });

    it("seeds cursor=0 when no traces are present yet", () => {
      const html = renderTraceViewerPage({ traces: [], summary: baseSummary });
      expect(html).toMatch(/cursor\s*=\s*0/);
    });

    it("caps the visible row count so a full buffer doesn't choke the DOM", () => {
      const traces: TraceRecord[] = [];
      for (let i = 0; i < 250; i++) traces.push(trace({ requestId: `r-${i}`, seq: i + 1 }));
      const html = renderTraceViewerPage({ traces, summary: baseSummary });
      // Render at most ~100 initial rows; the rest are reachable via
      // continued scroll / polling.
      const tbodyMatch = /<tbody[^>]*data-tv-tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(html);
      expect(tbodyMatch).toBeTruthy();
      const rows = (tbodyMatch?.[1] ?? "").match(/<tr/g) ?? [];
      expect(rows.length).toBeLessThanOrEqual(100);
    });
  });

  describe("Pro-Request drill-down (queries fired in this request)", () => {
    it("each row carries a click target that surfaces the requestId", () => {
      const html = renderTraceViewerPage({
        traces: [trace({ requestId: "req-xyz" })],
        summary: baseSummary,
      });
      // The drilldown wires off `data-trace-row` attributes; the JS
      // adds a click listener that fetches /dev/queries.json?requestId=…
      expect(html).toContain('data-trace-row="req-xyz"');
      expect(html).toMatch(/\/dev\/queries\.json\?requestId=/);
    });
  });
});
