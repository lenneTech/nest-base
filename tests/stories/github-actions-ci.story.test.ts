import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = resolve(import.meta.dirname, '..', '..');
const WORKFLOW_PATH = resolve(ROOT, '.github/workflows/ci.yml');

interface Job {
  'runs-on'?: string;
  steps?: Array<{ uses?: string; run?: string; name?: string; with?: Record<string, unknown> }>;
  'continue-on-error'?: boolean;
  services?: Record<string, unknown>;
}

interface Workflow {
  name?: string;
  on?: { push?: { branches?: string[] }; pull_request?: { branches?: string[] } };
  jobs?: Record<string, Job>;
}

/**
 * Story · GitHub Actions CI workflow.
 *
 * The template lives on GitHub (open source); consumer projects on
 * GitLab use `.gitlab-ci.yml`. So we mirror the same six quality gates
 * (lint, format, test:unit, test:e2e, test:types, test:coverage,
 * build) into a GitHub Actions workflow that runs on every push to
 * `main` and every PR targeting `main`.
 *
 * Test asserts the workflow shape — runners, triggers, gate coverage,
 * Bun setup — so contributors can't accidentally drop a gate when
 * editing the workflow.
 */
describe('Story · GitHub Actions CI workflow', () => {
  function readWorkflow(): Workflow {
    expect(existsSync(WORKFLOW_PATH), '.github/workflows/ci.yml must exist').toBe(true);
    return parse(readFileSync(WORKFLOW_PATH, 'utf8')) as Workflow;
  }

  it('triggers on push to main', () => {
    const wf = readWorkflow();
    expect(wf.on?.push?.branches).toContain('main');
  });

  it('triggers on pull requests targeting main', () => {
    const wf = readWorkflow();
    expect(wf.on?.pull_request?.branches).toContain('main');
  });

  it('runs all six quality gates: lint, format, test:unit, test:e2e, test:types, test:coverage, build', () => {
    const wf = readWorkflow();
    const jobs = wf.jobs ?? {};
    const allRunSteps = Object.values(jobs)
      .flatMap((j) => j.steps ?? [])
      .map((s) => s.run ?? '')
      .join('\n');
    expect(allRunSteps).toMatch(/bun run lint\b/);
    expect(allRunSteps).toMatch(/bun run format\b/);
    expect(allRunSteps).toMatch(/bun run test:unit\b/);
    expect(allRunSteps).toMatch(/bun run test:e2e\b/);
    expect(allRunSteps).toMatch(/bun run test:types\b/);
    expect(allRunSteps).toMatch(/bun run test:coverage\b/);
    expect(allRunSteps).toMatch(/bun run build\b/);
  });

  it('uses ubuntu-latest for every job (Docker available — testcontainers needs it)', () => {
    const wf = readWorkflow();
    for (const [name, job] of Object.entries(wf.jobs ?? {})) {
      expect(job['runs-on'], `job "${name}" missing runs-on`).toBe('ubuntu-latest');
    }
  });

  it('every job sets up Bun via oven-sh/setup-bun', () => {
    const wf = readWorkflow();
    for (const [name, job] of Object.entries(wf.jobs ?? {})) {
      const setupBun = job.steps?.find((s) => s.uses?.startsWith('oven-sh/setup-bun'));
      expect(setupBun, `job "${name}" must use oven-sh/setup-bun`).toBeDefined();
    }
  });

  it('every job checks out the repository before installing', () => {
    const wf = readWorkflow();
    for (const [name, job] of Object.entries(wf.jobs ?? {})) {
      const checkout = job.steps?.find((s) => s.uses?.startsWith('actions/checkout'));
      expect(checkout, `job "${name}" must use actions/checkout`).toBeDefined();
    }
  });

  it('every job installs dependencies with --frozen-lockfile (reproducible builds)', () => {
    const wf = readWorkflow();
    for (const [name, job] of Object.entries(wf.jobs ?? {})) {
      const installs = (job.steps ?? [])
        .map((s) => s.run ?? '')
        .filter((r) => /bun install/.test(r));
      expect(installs.length, `job "${name}" must run bun install`).toBeGreaterThan(0);
      expect(installs.some((r) => r.includes('--frozen-lockfile')), `job "${name}" must use --frozen-lockfile`).toBe(true);
    }
  });

  it('audit job is allowed to fail (advisory, not gating)', () => {
    const wf = readWorkflow();
    const audit = wf.jobs?.audit;
    expect(audit, 'audit job must exist').toBeDefined();
    expect(audit!['continue-on-error']).toBe(true);
  });

  it('top-level workflow has a human-readable name', () => {
    const wf = readWorkflow();
    expect(typeof wf.name).toBe('string');
    expect(wf.name!.length).toBeGreaterThan(0);
  });
});
