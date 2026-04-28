import { describe, expect, it } from 'vitest';

import {
  buildDevToolsConfig,
  type DevToolsConfigInput,
} from '../../src/core/dx/devtools-config.js';

/**
 * Story · NestJS DevTools config (PLAN.md §27.1 + §32 Phase 8).
 *
 * Pure builder for the DevtoolsModule.register() options bag plus
 * the NestFactory `snapshot` flag. The actual mount happens in the
 * NestJS bootstrap; the builder stays I/O-free so misconfiguration
 * surfaces in tests instead of at boot.
 *
 * Default behaviour matches PLAN.md §27.1:
 *   - dev:        enabled (HTTP transport on port 8000, snapshot on)
 *   - production: disabled (footprint-zero)
 *   - test:       disabled (no extra HTTP server during the suite)
 */
describe('Story · NestJS DevTools config', () => {
  function input(overrides: Partial<DevToolsConfigInput> = {}): DevToolsConfigInput {
    return { env: 'development', ...overrides };
  }

  describe('enabled defaults', () => {
    it('is enabled by default in development', () => {
      expect(buildDevToolsConfig(input({ env: 'development' })).enabled).toBe(true);
    });

    it('is disabled by default in production', () => {
      expect(buildDevToolsConfig(input({ env: 'production' })).enabled).toBe(false);
    });

    it('is disabled by default in test', () => {
      expect(buildDevToolsConfig(input({ env: 'test' })).enabled).toBe(false);
    });

    it('honours an explicit `enabled: false` in dev', () => {
      expect(buildDevToolsConfig(input({ env: 'development', enabled: false })).enabled).toBe(false);
    });

    it('honours an explicit `enabled: true` in production', () => {
      expect(buildDevToolsConfig(input({ env: 'production', enabled: true })).enabled).toBe(true);
    });
  });

  describe('port', () => {
    it('defaults to 8000', () => {
      expect(buildDevToolsConfig(input()).port).toBe(8000);
    });

    it('honours an explicit override', () => {
      expect(buildDevToolsConfig(input({ port: 4000 })).port).toBe(4000);
    });

    it('rejects a port below 1', () => {
      expect(() => buildDevToolsConfig(input({ port: 0 }))).toThrow(/port/i);
    });

    it('rejects a port above 65535', () => {
      expect(() => buildDevToolsConfig(input({ port: 70000 }))).toThrow(/port/i);
    });

    it('rejects a non-integer port', () => {
      expect(() => buildDevToolsConfig(input({ port: 1234.5 }))).toThrow(/port/i);
    });
  });

  describe('http transport', () => {
    it('defaults to true', () => {
      expect(buildDevToolsConfig(input()).http).toBe(true);
    });

    it('honours an explicit override', () => {
      expect(buildDevToolsConfig(input({ http: false })).http).toBe(false);
    });
  });

  describe('snapshot', () => {
    it('defaults to true (PLAN.md §32 calls this out explicitly)', () => {
      expect(buildDevToolsConfig(input()).snapshot).toBe(true);
    });

    it('can be turned off when not needed', () => {
      expect(buildDevToolsConfig(input({ snapshot: false })).snapshot).toBe(false);
    });
  });

  describe('cross-cutting', () => {
    it('rejects an unknown env value', () => {
      expect(() =>
        buildDevToolsConfig({ env: 'staging' as never }),
      ).toThrow(/env/i);
    });

    it('returns a frozen-shape object every call (no shared mutation)', () => {
      const a = buildDevToolsConfig(input());
      const b = buildDevToolsConfig(input());
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });
});
