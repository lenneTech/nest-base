import { describe, expect, it } from "vitest";

import { renderDiagnosticsPage } from "../../src/core/dx/diagnostics-ui.js";
import type { DiagnosticsReport } from "../../src/core/dx/diagnostics.js";

/**
 * Story · Diagnostics UI rendering — heap-percentage edge cases.
 *
 * The percentage bar previously did `(heapUsed / heapTotal) * 100`,
 * which produces nonsense values like 143% under Bun. Bun uses
 * JavaScriptCore (JSC) instead of V8 and reports the two numbers
 * out of different counters — `heapUsed` can exceed `heapTotal`
 * when JSC's allocator has handed out cells the committed-page
 * accounting hasn't caught up to yet. The rendered UI must:
 *
 *   - never show a percentage > 100 %
 *   - never paint a bar that overflows its track
 *   - surface the raw numbers so a curious user can still see them
 *   - explain the discrepancy so it doesn't look like a bug
 */
describe("Story · Diagnostics UI heap rendering", () => {
  function reportWith(memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  }): DiagnosticsReport {
    return {
      kind: "diagnostics-report",
      version: 1,
      runtime: {
        nodeVersion: "22.0.0",
        platform: "darwin",
        arch: "arm64",
      },
      app: { env: "development", version: "0.0.0", baseUrl: "http://localhost:3000" },
      process: {
        uptimeSeconds: 60,
        memory: { ...memory, external: 0, arrayBuffers: 0 },
        now: "2026-01-01T00:00:00Z",
      },
      features: {
        authMethods: [],
        socialProviders: [],
        multiTenancy: false,
        files: false,
        email: false,
        webhooks: false,
        search: false,
        realtime: false,
        powerSync: false,
        mcp: false,
        fieldEncryption: false,
        geo: false,
        rateLimit: false,
        idempotency: false,
        observability: false,
        jobs: false,
      },
      dependencies: { name: "nest-base" },
    };
  }

  it("normal case (heapUsed < heapTotal): percentage matches the expected ratio", () => {
    const html = renderDiagnosticsPage(
      reportWith({ rss: 100_000_000, heapTotal: 50_000_000, heapUsed: 25_000_000 }),
    );
    // 25M / 50M = 50%
    expect(html).toContain("(50%)");
  });

  it("Bun edge case (heapUsed > heapTotal): percentage is clamped to 100", () => {
    // Real-world reproducer: heapUsed > heapTotal — Bun's JSC
    // accounting can report the used count higher than the
    // committed heap.
    const HEAP_TOTAL = 37 * 1024 * 1024; // ~37 MiB
    const HEAP_USED = 52 * 1024 * 1024 + 800 * 1024; // ~52.8 MiB, used > committed
    const html = renderDiagnosticsPage(
      reportWith({ rss: 200_000_000, heapTotal: HEAP_TOTAL, heapUsed: HEAP_USED }),
    );
    expect(html).not.toMatch(/\b(?:1[0-9]{2}|[2-9][0-9]{2,})%\b/);
    expect(html).toContain("(100%)");
  });

  it("Bun edge case: bar fill width never exceeds 100%", () => {
    const HEAP_TOTAL = 37 * 1024 * 1024;
    const HEAP_USED = 52 * 1024 * 1024 + 800 * 1024;
    const html = renderDiagnosticsPage(
      reportWith({ rss: 200_000_000, heapTotal: HEAP_TOTAL, heapUsed: HEAP_USED }),
    );
    const matches = [...html.matchAll(/diag-bar__fill[^>]*width:\s*(\d+(?:\.\d+)?)%/g)];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(Number.parseFloat(m[1] as string)).toBeLessThanOrEqual(100);
    }
  });

  it("displays both raw values (heap used and heap total) so users can still inspect", () => {
    const HEAP_TOTAL = 37 * 1024 * 1024;
    const HEAP_USED = 52 * 1024 * 1024 + 800 * 1024;
    const html = renderDiagnosticsPage(
      reportWith({ rss: 200_000_000, heapTotal: HEAP_TOTAL, heapUsed: HEAP_USED }),
    );
    // The two numbers stay visible — we only fix the *percentage*.
    expect(html).toMatch(/52(\.\d)?\s*MB/);
    expect(html).toMatch(/37(\.\d)?\s*MB/);
  });

  it("includes a small note when used > total so the discrepancy doesn't look like a bug", () => {
    const HEAP_TOTAL = 37 * 1024 * 1024;
    const HEAP_USED = 52 * 1024 * 1024 + 800 * 1024;
    const html = renderDiagnosticsPage(
      reportWith({ rss: 200_000_000, heapTotal: HEAP_TOTAL, heapUsed: HEAP_USED }),
    );
    expect(html).toMatch(/Bun|JSC|heap accounting|committed/i);
  });

  it("zero heap-total guarded (no NaN / Infinity)", () => {
    const html = renderDiagnosticsPage(reportWith({ rss: 100_000_000, heapTotal: 0, heapUsed: 0 }));
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain("(0%)");
  });
});
