import { describe, expect, it } from 'vitest';

import {
  buildOnboardReport,
  type OnboardChecklistInput,
} from '../../src/core/dx/onboard.js';

/**
 * Story · `bun run onboard` (PLAN.md §32 Phase 8).
 *
 * Pure planner. The CLI runner gathers the inputs (Bun version,
 * Postgres reachability, presence of `.env`, Prisma client status,
 * test/lint/build availability) and feeds them into this builder.
 * The builder turns them into an ordered checklist with per-step
 * status + remediation hints.
 *
 * Keeping the planner I/O-free buys deterministic, machine-state-
 * free tests; the runner is a thin shell that prints the report.
 */
describe('Story · onboard report', () => {
  function input(overrides: Partial<OnboardChecklistInput> = {}): OnboardChecklistInput {
    return {
      bunVersion: '1.3.2',
      requiredBunVersion: '1.1.0',
      envFileExists: true,
      postgresReachable: true,
      prismaClientGenerated: true,
      migrationsUpToDate: true,
      ...overrides,
    };
  }

  describe('top-level shape', () => {
    it('emits the major sections', () => {
      const report = buildOnboardReport(input());
      expect(report.kind).toBe('onboard-report');
      expect(report.version).toBe(1);
      expect(Array.isArray(report.steps)).toBe(true);
    });

    it('returns a non-empty checklist regardless of input state', () => {
      expect(buildOnboardReport(input()).steps.length).toBeGreaterThan(0);
    });
  });

  describe('per-step status', () => {
    it('marks Bun OK when version satisfies the requirement', () => {
      const report = buildOnboardReport(input({ bunVersion: '1.3.2', requiredBunVersion: '1.1.0' }));
      const bun = report.steps.find((s) => s.id === 'bun');
      expect(bun?.status).toBe('ok');
    });

    it('marks Bun BLOCKED when version is too low', () => {
      const report = buildOnboardReport(input({ bunVersion: '1.0.5', requiredBunVersion: '1.1.0' }));
      const bun = report.steps.find((s) => s.id === 'bun');
      expect(bun?.status).toBe('blocked');
      expect(bun?.remediation).toMatch(/upgrade|install/i);
    });

    it('marks Bun BLOCKED when bunVersion is missing (Bun not installed)', () => {
      const report = buildOnboardReport(input({ bunVersion: undefined }));
      const bun = report.steps.find((s) => s.id === 'bun');
      expect(bun?.status).toBe('blocked');
    });

    it('marks env BLOCKED when .env file is missing', () => {
      const report = buildOnboardReport(input({ envFileExists: false }));
      const env = report.steps.find((s) => s.id === 'env');
      expect(env?.status).toBe('blocked');
      expect(env?.remediation).toMatch(/cp .env.example .env/);
    });

    it('marks postgres BLOCKED when not reachable', () => {
      const report = buildOnboardReport(input({ postgresReachable: false }));
      const pg = report.steps.find((s) => s.id === 'postgres');
      expect(pg?.status).toBe('blocked');
      expect(pg?.remediation).toMatch(/docker compose up/);
    });

    it('marks prisma WARNING when client not generated yet', () => {
      const report = buildOnboardReport(input({ prismaClientGenerated: false }));
      const prisma = report.steps.find((s) => s.id === 'prisma-generate');
      expect(prisma?.status).toBe('warning');
      expect(prisma?.remediation).toMatch(/prisma generate/);
    });

    it('marks migrations WARNING when not up to date', () => {
      const report = buildOnboardReport(input({ migrationsUpToDate: false }));
      const m = report.steps.find((s) => s.id === 'migrations');
      expect(m?.status).toBe('warning');
      expect(m?.remediation).toMatch(/prisma:migrate|migrate dev/);
    });
  });

  describe('summary', () => {
    it('returns ok=true when every step is ok', () => {
      expect(buildOnboardReport(input()).ok).toBe(true);
    });

    it('returns ok=false if any step is blocked', () => {
      expect(buildOnboardReport(input({ envFileExists: false })).ok).toBe(false);
    });

    it('returns ok=true even with warnings — warnings don\'t block onboarding', () => {
      expect(
        buildOnboardReport(
          input({ prismaClientGenerated: false, migrationsUpToDate: false }),
        ).ok,
      ).toBe(true);
    });

    it('counts blocked / warning / ok in the summary', () => {
      const report = buildOnboardReport(
        input({ envFileExists: false, prismaClientGenerated: false }),
      );
      expect(report.summary.blocked).toBeGreaterThanOrEqual(1);
      expect(report.summary.warning).toBeGreaterThanOrEqual(1);
      expect(report.summary.ok).toBeGreaterThanOrEqual(1);
    });
  });

  describe('determinism', () => {
    it('returns byte-identical output for byte-identical input', () => {
      expect(JSON.stringify(buildOnboardReport(input()))).toBe(JSON.stringify(buildOnboardReport(input())));
    });
  });

  describe('step ordering', () => {
    it('orders steps from prerequisite (bun) to last-mile (migrations)', () => {
      const ids = buildOnboardReport(input()).steps.map((s) => s.id);
      const bunPos = ids.indexOf('bun');
      const envPos = ids.indexOf('env');
      const pgPos = ids.indexOf('postgres');
      const prismaPos = ids.indexOf('prisma-generate');
      const migPos = ids.indexOf('migrations');
      expect(bunPos).toBeLessThan(envPos);
      expect(envPos).toBeLessThan(pgPos);
      expect(pgPos).toBeLessThan(prismaPos);
      expect(prismaPos).toBeLessThan(migPos);
    });
  });
});
