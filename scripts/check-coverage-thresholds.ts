#!/usr/bin/env bun
/**
 * `scripts/check-coverage-thresholds.ts` — gate the coverage report
 * from `reports/coverage/coverage-summary.json` against the per-folder
 * thresholds the PRD pins (SC.QG.08 + SC.QG.09):
 *
 *   - `src/core/**`   ≥ 80 % lines (PRD relaxed from 90 %)
 *   - `src/modules/**` ≥ 75 % lines
 *
 * The script also asserts the overall total is ≥ 80 % so a regression
 * that hides itself behind a per-folder bias still trips the gate.
 *
 * Exits non-zero on any miss so `scripts/verify-spec.sh` can surface
 * the failure cleanly.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface CoverageBucket {
  readonly total: number;
  readonly covered: number;
  readonly pct: number;
}

interface PerFileEntry {
  readonly lines: CoverageBucket;
  readonly statements: CoverageBucket;
  readonly functions: CoverageBucket;
  readonly branches: CoverageBucket;
}

interface CoverageSummary {
  readonly total: PerFileEntry;
  readonly [path: string]: PerFileEntry;
}

const ROOT = resolve(__dirname, "..");
const SUMMARY_PATH = resolve(ROOT, "reports/coverage/coverage-summary.json");

const CORE_LINES_THRESHOLD = 80;
const MODULES_LINES_THRESHOLD = 75;
const TOTAL_LINES_THRESHOLD = 80;

function aggregateByPrefix(summary: CoverageSummary, prefix: string): CoverageBucket {
  let total = 0;
  let covered = 0;
  for (const [path, entry] of Object.entries(summary)) {
    if (path === "total") continue;
    if (!path.includes(prefix)) continue;
    total += entry.lines.total;
    covered += entry.lines.covered;
  }
  return {
    total,
    covered,
    pct: total === 0 ? 0 : (covered / total) * 100,
  };
}

function main(): void {
  const raw = readFileSync(SUMMARY_PATH, "utf8");
  const summary = JSON.parse(raw) as CoverageSummary;

  const core = aggregateByPrefix(summary, "/src/core/");
  const modules = aggregateByPrefix(summary, "/src/modules/");
  const totalLinesPct = summary.total.lines.pct;

  const checks = [
    {
      name: "src/core/** lines",
      pct: core.pct,
      threshold: CORE_LINES_THRESHOLD,
      detail: `${core.covered}/${core.total} lines covered`,
    },
    {
      name: "src/modules/** lines",
      pct: modules.pct,
      threshold: MODULES_LINES_THRESHOLD,
      detail: `${modules.covered}/${modules.total} lines covered`,
    },
    {
      name: "overall lines",
      pct: totalLinesPct,
      threshold: TOTAL_LINES_THRESHOLD,
      detail: `${summary.total.lines.covered}/${summary.total.lines.total} lines covered`,
    },
  ];

  let allPassed = true;
  for (const check of checks) {
    const ok = check.pct >= check.threshold;
    const symbol = ok ? "✓" : "✗";
    process.stdout.write(
      `${symbol} ${check.name}: ${check.pct.toFixed(2)} % (${check.detail}) [threshold ≥ ${check.threshold} %]\n`,
    );
    if (!ok) allPassed = false;
  }

  if (!allPassed) {
    process.exit(1);
  }
}

main();
