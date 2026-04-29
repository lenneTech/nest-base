import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runSetupWizard, type SetupWizardLogger } from '../../src/core/setup/setup-wizard-runner.js';

/**
 * Story · `bun run setup` runner I/O behaviour.
 *
 * Tests pin the real file-system contract:
 *   - reads `.env.example` from the project root
 *   - writes `.env` with substituted secrets
 *   - is idempotent: refuses to overwrite an existing `.env`
 *   - if `.env.example` is missing, generates one from the planner
 *     so a fresh checkout can run the command without manual setup.
 */
describe('Story · bun run setup runner I/O', () => {
  let workspace: string;
  let logs: string[];
  const logger: SetupWizardLogger = {
    info: (msg) => logs.push(`INFO ${msg}`),
    warn: (msg) => logs.push(`WARN ${msg}`),
  };

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'setup-wizard-'));
    logs = [];
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('writes a .env file with substituted secrets when .env.example exists', () => {
    writeFileSync(
      join(workspace, '.env.example'),
      [
        'POSTGRES_USER=app',
        'POSTGRES_PASSWORD=change-me-strong-pass',
        'BETTER_AUTH_SECRET=change-me-32-chars-minimum-XXXXXX',
        'NODE_ENV=development',
      ].join('\n') + '\n',
    );
    const result = runSetupWizard({ projectRoot: workspace, logger });
    expect(result.envPath).toBe(join(workspace, '.env'));
    expect(result.created).toBe(true);

    const written = readFileSync(result.envPath, 'utf8');
    expect(written).not.toContain('change-me-strong-pass');
    expect(written).not.toContain('change-me-32-chars-minimum-XXXXXX');
    expect(written).toMatch(/^NODE_ENV=development$/m);
  });

  it('refuses to overwrite an existing .env (idempotent, no clobber)', () => {
    writeFileSync(join(workspace, '.env.example'), 'NODE_ENV=development\n');
    writeFileSync(join(workspace, '.env'), 'EXISTING=keep-me\n');

    const result = runSetupWizard({ projectRoot: workspace, logger });
    expect(result.created).toBe(false);
    expect(readFileSync(join(workspace, '.env'), 'utf8')).toBe('EXISTING=keep-me\n');
    expect(logs.some((l) => /already exists/.test(l))).toBe(true);
  });

  it('generates .env.example from the default planner when missing', () => {
    // No .env.example present.
    const result = runSetupWizard({ projectRoot: workspace, logger });
    expect(existsSync(join(workspace, '.env.example'))).toBe(true);
    expect(result.created).toBe(true);
    const example = readFileSync(join(workspace, '.env.example'), 'utf8');
    expect(example).toMatch(/^DATABASE_URL=/m);
    expect(example).toMatch(/^BETTER_AUTH_SECRET=/m);
  });

  it('returns the path to the generated .env so callers can chain', () => {
    writeFileSync(join(workspace, '.env.example'), 'NODE_ENV=development\n');
    const result = runSetupWizard({ projectRoot: workspace, logger });
    expect(result.envPath).toBe(join(workspace, '.env'));
  });
});
