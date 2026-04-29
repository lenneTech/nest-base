/**
 * Coverage-Report planner.
 *
 * Pure parser for the `coverage/coverage-summary.json` artifact that
 * Vitest emits via `bun run test:coverage`. Maps the v8 reporter shape
 * to a UI-friendly structure: per-file rows, per-tier metric, and a
 * gate verdict for the configured 90 % core / 80 % modules thresholds.
 *
 * Pure means: input is a parsed JSON object (or undefined when the
 * file hasn't been generated yet), output is the same struct every
 * time. The runner reads `coverage/coverage-summary.json` from disk.
 */

export type CoverageMetric = "lines" | "statements" | "branches" | "functions";

export interface CoverageBucket {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

/** Raw shape (subset) of vitest+v8's `coverage-summary.json`. */
export interface RawCoverageSummary {
  total?: Record<CoverageMetric, CoverageBucket>;
  [path: string]: Record<CoverageMetric, CoverageBucket> | undefined;
}

export interface CoverageFileRow {
  /** Repo-relative path (e.g. `src/core/foo.ts`). */
  path: string;
  /** Categorized bucket — drives the gate threshold. */
  tier: "core" | "modules" | "shared" | "other";
  metrics: Record<CoverageMetric, CoverageBucket>;
  /** True when this file's lines pct meets the tier threshold. */
  meetsThreshold: boolean;
}

export interface CoverageReport {
  available: boolean;
  generatedAt?: string;
  total?: Record<CoverageMetric, CoverageBucket>;
  files: CoverageFileRow[];
  thresholds: { core: number; modules: number; shared: number };
  gate: {
    coreOk: boolean;
    modulesOk: boolean;
    overallOk: boolean;
  };
}

export interface CoverageReportInput {
  /** Parsed JSON of `coverage/coverage-summary.json`. Undefined ⇒ no run yet. */
  summary?: RawCoverageSummary;
  /** Repo root path; used to relativize the absolute file paths. */
  repoRoot: string;
  /** Optional file mtime for the "generated at" hint. */
  generatedAt?: string;
}

const DEFAULT_THRESHOLDS = { core: 90, modules: 80, shared: 80 } as const;

export function buildCoverageReport(input: CoverageReportInput): CoverageReport {
  if (!input.summary) {
    return {
      available: false,
      files: [],
      thresholds: { ...DEFAULT_THRESHOLDS },
      gate: { coreOk: false, modulesOk: false, overallOk: false },
    };
  }
  const { summary, repoRoot } = input;
  const total = summary.total;
  const files: CoverageFileRow[] = [];
  for (const [absPath, metrics] of Object.entries(summary)) {
    if (absPath === "total" || !metrics) continue;
    const rel = relativize(absPath, repoRoot);
    const tier = tierForPath(rel);
    const threshold = thresholdFor(tier, DEFAULT_THRESHOLDS);
    files.push({
      path: rel,
      tier,
      metrics,
      meetsThreshold: metrics.lines.pct >= threshold,
    });
  }
  files.sort((a, b) => a.metrics.lines.pct - b.metrics.lines.pct);

  const coreFiles = files.filter((f) => f.tier === "core");
  const moduleFiles = files.filter((f) => f.tier === "modules");
  const coreOk = coreFiles.every((f) => f.meetsThreshold);
  const modulesOk = moduleFiles.every((f) => f.meetsThreshold);
  return {
    available: true,
    ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
    ...(total ? { total } : {}),
    files,
    thresholds: { ...DEFAULT_THRESHOLDS },
    gate: { coreOk, modulesOk, overallOk: coreOk && modulesOk },
  };
}

function relativize(absPath: string, repoRoot: string): string {
  const root = repoRoot.endsWith("/") ? repoRoot : `${repoRoot}/`;
  return absPath.startsWith(root) ? absPath.slice(root.length) : absPath;
}

function tierForPath(rel: string): CoverageFileRow["tier"] {
  if (rel.startsWith("src/core/")) return "core";
  if (rel.startsWith("src/modules/")) return "modules";
  if (rel.startsWith("src/shared/")) return "shared";
  return "other";
}

function thresholdFor(
  tier: CoverageFileRow["tier"],
  thresholds: typeof DEFAULT_THRESHOLDS,
): number {
  if (tier === "core") return thresholds.core;
  if (tier === "modules") return thresholds.modules;
  if (tier === "shared") return thresholds.shared;
  return 0;
}
