import { describe, expect, it } from 'vitest';

import {
  planEnvFromExample,
  type RandomBytesFn,
} from '../../src/core/setup/setup-wizard-runner.js';

/**
 * Story · `bun run setup` runner planner (PLAN.md §19.5 + §32 Phase 7).
 *
 * The runner is the I/O wrapper around the existing `planSetup()`
 * planner; it copies `.env.example` → `.env` and substitutes the
 * placeholder secrets with cryptographically random values. To keep
 * the runner thin, the substitution itself is a *pure planner* that
 * takes the raw `.env.example` text + an injectable RNG and returns
 * the rendered `.env` text.
 *
 * Two security invariants pinned here:
 *   1. Every recognised placeholder gets a fresh secret (never the
 *      example placeholder — that would ship "change-me-…" to prod).
 *   2. Unknown lines pass through untouched, so contributors can add
 *      new env vars without the runner silently dropping them.
 */
describe('Story · setup-wizard runner planner', () => {
  function deterministicRng(): RandomBytesFn {
    let seed = 0;
    return (size) => {
      const buf = Buffer.alloc(size);
      for (let i = 0; i < size; i++) {
        buf[i] = (seed = (seed * 31 + 7) & 0xff);
      }
      return buf;
    };
  }

  it('substitutes BETTER_AUTH_SECRET placeholder with a fresh 32-char-min secret', () => {
    const example = 'BETTER_AUTH_SECRET=change-me-32-chars-minimum-XXXXXX\n';
    const out = planEnvFromExample(example, { randomBytes: deterministicRng() });
    const value = out.match(/^BETTER_AUTH_SECRET=(.*)$/m)?.[1];
    expect(value).toBeDefined();
    expect(value).not.toBe('change-me-32-chars-minimum-XXXXXX');
    expect(value!.length).toBeGreaterThanOrEqual(32);
  });

  it('substitutes POSTGRES_PASSWORD placeholder', () => {
    const example = 'POSTGRES_PASSWORD=change-me-strong-pass\n';
    const out = planEnvFromExample(example, { randomBytes: deterministicRng() });
    const value = out.match(/^POSTGRES_PASSWORD=(.*)$/m)?.[1];
    expect(value).not.toBe('change-me-strong-pass');
    expect(value!.length).toBeGreaterThanOrEqual(16);
  });

  it('updates DATABASE_URL with the freshly generated POSTGRES_PASSWORD', () => {
    const example = [
      'POSTGRES_USER=app',
      'POSTGRES_PASSWORD=change-me-strong-pass',
      'POSTGRES_DB=app',
      'DATABASE_URL=postgresql://app:change-me-strong-pass@localhost:5432/app',
    ].join('\n');
    const out = planEnvFromExample(example, { randomBytes: deterministicRng() });
    const password = out.match(/^POSTGRES_PASSWORD=(.*)$/m)?.[1];
    const url = out.match(/^DATABASE_URL=(.*)$/m)?.[1];
    expect(url).toContain(password!);
    expect(url).not.toContain('change-me-strong-pass');
  });

  it('substitutes SYSTEM_SETUP_ADMIN_PASSWORD placeholder (≥ 12 chars per schema)', () => {
    const example = 'SYSTEM_SETUP_ADMIN_PASSWORD=change-me-12-chars-min\n';
    const out = planEnvFromExample(example, { randomBytes: deterministicRng() });
    const value = out.match(/^SYSTEM_SETUP_ADMIN_PASSWORD=(.*)$/m)?.[1];
    expect(value).toBeDefined();
    expect(value).not.toBe('change-me-12-chars-min');
    // SystemSetupConfigSchema enforces min 12; we want strong-margin above that.
    expect(value!.length).toBeGreaterThanOrEqual(16);
  });

  it('substitutes POWERSYNC_DB_PASSWORD placeholder', () => {
    const example = 'POWERSYNC_DB_PASSWORD=change-me-powersync-replication-pass\n';
    const out = planEnvFromExample(example, { randomBytes: deterministicRng() });
    const value = out.match(/^POWERSYNC_DB_PASSWORD=(.*)$/m)?.[1];
    expect(value).not.toBe('change-me-powersync-replication-pass');
    expect(value!.length).toBeGreaterThanOrEqual(16);
  });

  it('substitutes FIELD_ENCRYPTION_KEK with a 32-byte base64 value', () => {
    const example = 'FIELD_ENCRYPTION_KEK=\n';
    const out = planEnvFromExample(example, { randomBytes: deterministicRng() });
    const value = out.match(/^FIELD_ENCRYPTION_KEK=(.*)$/m)?.[1];
    expect(value).toBeDefined();
    // 32 bytes base64-encoded → 44 characters (with `=` padding).
    expect(Buffer.from(value!, 'base64').length).toBe(32);
  });

  it('preserves comments, blank lines, and unknown vars verbatim', () => {
    const example = [
      '# Comment',
      '',
      'CUSTOM_VAR=hello',
      'NODE_ENV=development',
      'PORT=3000',
    ].join('\n');
    const out = planEnvFromExample(example, { randomBytes: deterministicRng() });
    expect(out).toContain('# Comment');
    expect(out).toContain('CUSTOM_VAR=hello');
    expect(out).toContain('NODE_ENV=development');
    expect(out).toContain('PORT=3000');
  });

  it('produces different secrets per run (RNG is consulted, not hard-coded)', () => {
    const example = 'BETTER_AUTH_SECRET=change-me-32-chars-minimum-XXXXXX\n';
    const a = planEnvFromExample(example, { randomBytes: deterministicRng() });
    let b: string;
    {
      let seed = 99;
      b = planEnvFromExample(example, {
        randomBytes: (size) => {
          const buf = Buffer.alloc(size);
          for (let i = 0; i < size; i++) buf[i] = (seed = (seed * 17 + 11) & 0xff);
          return buf;
        },
      });
    }
    expect(a).not.toBe(b);
  });

  it('output ends with a trailing newline (POSIX file convention)', () => {
    const example = 'NODE_ENV=development\n';
    const out = planEnvFromExample(example, { randomBytes: deterministicRng() });
    expect(out.endsWith('\n')).toBe(true);
  });
});
