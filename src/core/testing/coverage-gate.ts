/**
 * Coverage-Gate — single source of truth for the coverage thresholds.
 *
 * Vitest reads these in `vitest.config.ts` to fail the test step when
 * coverage drops. GitLab CI runs `bun run test:coverage`, so the same
 * thresholds break the pipeline if a regression is introduced.
 *
 * Lines stays the headline metric; the other dimensions are
 * deliberately looser:
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

// PRD § Success Criteria pins:
//   src/core/**   ≥ 80 % lines
//   src/modules/** ≥ 75 % lines
// Current coverage (iter-59 measurement) is 92.87 % / 95.45 %, well
// above the PRD floor — bumping the gate to the PRD floor turns the
// threshold from a permissive check into a real protection.
export const CORE_COVERAGE_THRESHOLD: CoverageThreshold = {
  lines: 80,
  statements: 75,
  functions: 80,
  branches: 70,
};

export const MODULES_COVERAGE_THRESHOLD: CoverageThreshold = {
  lines: 75,
  statements: 70,
  functions: 75,
  branches: 65,
};

export const coverageThresholds: Record<string, CoverageThreshold> = {
  "src/core/**": CORE_COVERAGE_THRESHOLD,
  "src/modules/**": MODULES_COVERAGE_THRESHOLD,
};
