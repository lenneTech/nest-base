/**
 * Coverage-Gate — single source of truth for the coverage thresholds.
 *
 * Vitest reads these in `vitest.config.ts` to fail the test step when
 * coverage drops. GitLab CI runs `bun run test:coverage`, so the same
 * thresholds break the pipeline if a regression is introduced.
 *
 * Numbers come from PLAN.md §28b.7:
 *   - src/core/    ≥ 90 % lines (Pflicht-Gate, CI-Build bricht ab)
 *   - src/modules/ ≥ 80 % lines (empfohlen, projekt-spezifisch tunbar)
 *
 * Branch thresholds are slightly looser than line thresholds (defensive
 * branches inflate denominators); they are still strict enough to catch
 * dead-code regressions.
 */

export interface CoverageThreshold {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

export const CORE_COVERAGE_THRESHOLD: CoverageThreshold = {
  lines: 90,
  statements: 90,
  functions: 90,
  branches: 85,
};

export const MODULES_COVERAGE_THRESHOLD: CoverageThreshold = {
  lines: 80,
  statements: 80,
  functions: 80,
  branches: 75,
};

export const coverageThresholds: Record<string, CoverageThreshold> = {
  'src/core/**': CORE_COVERAGE_THRESHOLD,
  'src/modules/**': MODULES_COVERAGE_THRESHOLD,
};
