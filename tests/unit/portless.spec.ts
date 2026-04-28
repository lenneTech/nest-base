import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveDevPort, shouldUsePortless } from '../../src/core/dev/portless.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PORTLESS_YML = resolve(ROOT, 'portless.yml');
const PACKAGE_JSON = resolve(ROOT, 'package.json');

/**
 * portless integration (PLAN.md §28.10/#30).
 *
 * Local dev routing exposes services under `<service>.<project>.localhost`
 * with automatic HTTPS (mkcert). `bun run dev` boots portless when it's
 * available; otherwise it falls back to a dynamically assigned port so
 * devs without portless are not blocked.
 */
describe('portless config', () => {
  const yaml = existsSync(PORTLESS_YML) ? readFileSync(PORTLESS_YML, 'utf8') : '';

  it('declares the project name as `nst`', () => {
    expect(yaml).toMatch(/^project:\s*nst\b/m);
  });

  it('routes the API service to the running server', () => {
    expect(yaml).toMatch(/^\s{2}api:/m);
    expect(yaml).toMatch(/api\.nst\.localhost/);
  });

  it('routes the dev panels for Mailpit and RustFS', () => {
    expect(yaml).toMatch(/mail\.nst\.localhost/);
    expect(yaml).toMatch(/s3\.nst\.localhost/);
  });
});

describe('dev runner', () => {
  describe('shouldUsePortless()', () => {
    it('returns false when the portless binary is not on PATH', () => {
      expect(shouldUsePortless({ portlessPath: undefined })).toBe(false);
    });

    it('returns true when a portless binary path is provided', () => {
      expect(shouldUsePortless({ portlessPath: '/usr/local/bin/portless' })).toBe(true);
    });

    it('respects an explicit DISABLE_PORTLESS=1 override even when the binary is present', () => {
      expect(shouldUsePortless({ portlessPath: '/bin/portless', disable: true })).toBe(false);
    });
  });

  describe('resolveDevPort()', () => {
    it('returns the configured PORT when set', () => {
      expect(resolveDevPort({ env: { PORT: '4000' }, portlessAvailable: false })).toBe(4000);
    });

    it('returns 3000 (template default) when PORT is unset and portless is available', () => {
      expect(resolveDevPort({ env: {}, portlessAvailable: true })).toBe(3000);
    });

    it('returns 0 (dynamic) when PORT is unset and portless is not available', () => {
      expect(resolveDevPort({ env: {}, portlessAvailable: false })).toBe(0);
    });

    it('throws when PORT is set but not numeric', () => {
      expect(() => resolveDevPort({ env: { PORT: 'abc' }, portlessAvailable: true })).toThrow();
    });
  });

  describe('package.json wiring', () => {
    it('the `dev` script delegates to scripts/dev.ts (not directly bun --watch)', () => {
      const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { scripts: Record<string, string> };
      expect(pkg.scripts.dev).toMatch(/scripts\/dev\.ts/);
    });
  });
});
