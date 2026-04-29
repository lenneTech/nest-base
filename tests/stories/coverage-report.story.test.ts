import { describe, expect, it } from "vitest";

import { buildCoverageReport, type RawCoverageSummary } from "../../src/core/dx/coverage-report.js";

describe("Story · Coverage-Report", () => {
  const repoRoot = "/repo";
  const bucket = (pct: number) => ({ total: 100, covered: pct, skipped: 0, pct });
  const metrics = (pct: number) => ({
    lines: bucket(pct),
    statements: bucket(pct),
    branches: bucket(pct),
    functions: bucket(pct),
  });

  it("liefert `available: false` wenn kein Summary vorhanden", () => {
    const r = buildCoverageReport({ repoRoot });
    expect(r.available).toBe(false);
    expect(r.files).toEqual([]);
    expect(r.gate.overallOk).toBe(false);
  });

  it("relativiert absolute Pfade gegen den Repo-Root", () => {
    const summary: RawCoverageSummary = {
      total: metrics(95),
      "/repo/src/core/foo.ts": metrics(95),
    };
    const r = buildCoverageReport({ summary, repoRoot });
    expect(r.files).toHaveLength(1);
    expect(r.files[0]?.path).toBe("src/core/foo.ts");
    expect(r.files[0]?.tier).toBe("core");
  });

  it("kategorisiert nach Pfad: core / modules / shared / other", () => {
    const summary: RawCoverageSummary = {
      "/repo/src/core/a.ts": metrics(95),
      "/repo/src/modules/b.ts": metrics(85),
      "/repo/src/shared/c.ts": metrics(85),
      "/repo/src/main.ts": metrics(50),
    };
    const r = buildCoverageReport({ summary, repoRoot });
    const byPath = new Map(r.files.map((f) => [f.path, f.tier]));
    expect(byPath.get("src/core/a.ts")).toBe("core");
    expect(byPath.get("src/modules/b.ts")).toBe("modules");
    expect(byPath.get("src/shared/c.ts")).toBe("shared");
    expect(byPath.get("src/main.ts")).toBe("other");
  });

  it("flaggt Gate-Verstöße: core unter 90 % schlägt fehl", () => {
    const summary: RawCoverageSummary = {
      "/repo/src/core/ok.ts": metrics(91),
      "/repo/src/core/bad.ts": metrics(70),
    };
    const r = buildCoverageReport({ summary, repoRoot });
    expect(r.gate.coreOk).toBe(false);
    expect(r.files.find((f) => f.path === "src/core/bad.ts")?.meetsThreshold).toBe(false);
    expect(r.files.find((f) => f.path === "src/core/ok.ts")?.meetsThreshold).toBe(true);
  });

  it("modules-Gate liegt bei 80 %", () => {
    const summary: RawCoverageSummary = {
      "/repo/src/modules/ok.ts": metrics(80),
      "/repo/src/modules/bad.ts": metrics(79),
    };
    const r = buildCoverageReport({ summary, repoRoot });
    expect(r.gate.modulesOk).toBe(false);
    expect(r.files.find((f) => f.path === "src/modules/ok.ts")?.meetsThreshold).toBe(true);
    expect(r.files.find((f) => f.path === "src/modules/bad.ts")?.meetsThreshold).toBe(false);
  });

  it("sortiert Dateien aufsteigend nach Lines-Coverage (schlechteste oben)", () => {
    const summary: RawCoverageSummary = {
      "/repo/src/core/a.ts": metrics(95),
      "/repo/src/core/b.ts": metrics(70),
      "/repo/src/core/c.ts": metrics(85),
    };
    const r = buildCoverageReport({ summary, repoRoot });
    expect(r.files.map((f) => f.path)).toEqual(["src/core/b.ts", "src/core/c.ts", "src/core/a.ts"]);
  });

  it("propagiert Total-Bucket und generatedAt", () => {
    const summary: RawCoverageSummary = {
      total: metrics(94.5),
      "/repo/src/core/a.ts": metrics(95),
    };
    const r = buildCoverageReport({
      summary,
      repoRoot,
      generatedAt: "2026-04-29T12:00:00Z",
    });
    expect(r.total?.lines.pct).toBe(94.5);
    expect(r.generatedAt).toBe("2026-04-29T12:00:00Z");
  });
});
