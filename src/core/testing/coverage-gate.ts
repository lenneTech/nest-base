/**
 * Coverage-Gate — single source of truth for the coverage thresholds.
 *
 * Vitest reads these in `vitest.config.ts` to fail the test step when
 * coverage drops. GitLab CI runs `bun run test:coverage`, so the same
 * thresholds break the pipeline if a regression is introduced.
 *
 * Numbers come from PLAN.md §28b.7. Lines stays the headline metric;
 * the other dimensions are deliberately looser:
 *   - statements: defensive runtime guards (`if (!input) return …`)
 *     inflate the denominator without representing real risk.
 *   - functions: getter / setter / one-line helper count balloons in
 *     a TS codebase without being meaningful coverage.
 *   - branches: same — defensive branches drag the metric down.
 *
 * The thresholds are tuned so the current codebase passes comfortably
 * with margin. A meaningful regression (a whole untested helper, a
 * missing red-path) still trips the gate; cosmetic refactors or new
 * defensive guards do not.
 */

export interface CoverageThreshold {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

export const CORE_COVERAGE_THRESHOLD: CoverageThreshold = {
  lines: 70,
  statements: 60,
  functions: 70,
  branches: 50,
};

export const MODULES_COVERAGE_THRESHOLD: CoverageThreshold = {
  lines: 60,
  statements: 50,
  functions: 60,
  branches: 45,
};

export const coverageThresholds: Record<string, CoverageThreshold> = {
  "src/core/**": CORE_COVERAGE_THRESHOLD,
  "src/modules/**": MODULES_COVERAGE_THRESHOLD,
};
