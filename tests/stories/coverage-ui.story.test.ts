import { describe, expect, it } from "vitest";

import { buildCoverageReport, type RawCoverageSummary } from "../../src/core/dx/coverage-report.js";
import { renderCoveragePage } from "../../src/core/dx/coverage-ui.js";

const bucket = (pct: number) => ({ total: 100, covered: pct, skipped: 0, pct });
const metrics = (pct: number) => ({
  lines: bucket(pct),
  statements: bucket(pct),
  branches: bucket(pct),
  functions: bucket(pct),
});

describe("Story · Coverage UI", () => {
  it("zeigt Empty-State wenn kein Report verfügbar", () => {
    const html = renderCoveragePage(buildCoverageReport({ repoRoot: "/r" }));
    expect(html).toMatch(/Coverage report not generated/i);
    expect(html).toMatch(/bun run test:coverage/);
  });

  it("rendert Total-Tiles mit Lines/Statements/Branches/Functions", () => {
    const summary: RawCoverageSummary = {
      total: metrics(95),
      "/r/src/core/a.ts": metrics(95),
    };
    const html = renderCoveragePage(buildCoverageReport({ summary, repoRoot: "/r" }));
    expect(html).toContain("Lines");
    expect(html).toContain("Statements");
    expect(html).toContain("Branches");
    expect(html).toContain("Functions");
    expect(html).toContain("95.00%");
  });

  it("rendert per-File-Tabelle mit Tier und data-coverage-files", () => {
    const summary: RawCoverageSummary = {
      "/r/src/core/foo.ts": metrics(91),
      "/r/src/modules/bar.ts": metrics(82),
    };
    const html = renderCoveragePage(buildCoverageReport({ summary, repoRoot: "/r" }));
    expect(html).toMatch(/data-coverage-files="true"/);
    expect(html).toContain("src/core/foo.ts");
    expect(html).toContain("src/modules/bar.ts");
    expect(html).toContain("core");
    expect(html).toContain("modules");
  });

  it("flaggt Dateien unter Threshold via data-below-threshold", () => {
    const summary: RawCoverageSummary = {
      "/r/src/core/bad.ts": metrics(70),
      "/r/src/core/ok.ts": metrics(95),
    };
    const html = renderCoveragePage(buildCoverageReport({ summary, repoRoot: "/r" }));
    expect(html).toMatch(/data-below-threshold="true"[^>]*>[\s\S]*src\/core\/bad\.ts/);
  });

  it("zeigt Gate-Status-Badges für core und modules", () => {
    const summary: RawCoverageSummary = {
      "/r/src/core/a.ts": metrics(91),
      "/r/src/modules/b.ts": metrics(85),
    };
    const html = renderCoveragePage(buildCoverageReport({ summary, repoRoot: "/r" }));
    expect(html).toMatch(/Core ≥ 90%/);
    expect(html).toMatch(/Modules ≥ 80%/);
  });

  it("eskapiert User-Pfade gegen XSS", () => {
    const summary: RawCoverageSummary = {
      "/r/src/core/<script>alert(1)</script>.ts": metrics(95),
    };
    const html = renderCoveragePage(buildCoverageReport({ summary, repoRoot: "/r" }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
