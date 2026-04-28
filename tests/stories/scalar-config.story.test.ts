import { describe, expect, it } from 'vitest';

import {
  ScalarSpecRequiredError,
  buildScalarConfig,
  type ScalarConfigInput,
} from '../../src/core/dx/scalar-config.js';

/**
 * Story · Scalar API-UI config (PLAN.md §32 Phase 8).
 *
 * Thin config builder that produces the options bag consumed by
 * `@scalar/nestjs-api-reference`'s `apiReference()` middleware. The
 * actual mount happens in the NestJS bootstrap; the builder stays
 * I/O-free so misconfiguration (no spec source, conflicting fields)
 * surfaces in tests rather than at first request.
 *
 * Defaults match what every project will want — Bun-friendly title,
 * default theme, dark-mode toggle visible. Apps override only what
 * they care about.
 */
describe('Story · Scalar API-UI config', () => {
  function input(overrides: Partial<ScalarConfigInput> = {}): ScalarConfigInput {
    return { specUrl: '/api/openapi.json', ...overrides };
  }

  describe('spec source', () => {
    it('passes specUrl through as `url`', () => {
      const cfg = buildScalarConfig({ specUrl: '/api/openapi.json' });
      expect(cfg.url).toBe('/api/openapi.json');
    });

    it('passes inline spec through as `content`', () => {
      const spec = { openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: {} };
      const cfg = buildScalarConfig({ spec });
      expect(cfg.content).toBe(spec);
    });

    it('throws ScalarSpecRequiredError when neither specUrl nor spec is provided', () => {
      expect(() => buildScalarConfig({})).toThrow(ScalarSpecRequiredError);
    });

    it('prefers inline spec when both specUrl and spec are provided (debug-friendly)', () => {
      const spec = { openapi: '3.1.0', info: { title: 'X', version: '1' }, paths: {} };
      const cfg = buildScalarConfig({ specUrl: '/api/openapi.json', spec });
      expect(cfg.content).toBe(spec);
      expect(cfg.url).toBeUndefined();
    });
  });

  describe('defaults', () => {
    it('uses theme="default" when not specified', () => {
      expect(buildScalarConfig(input()).theme).toBe('default');
    });

    it('keeps the dark-mode toggle visible by default', () => {
      expect(buildScalarConfig(input()).hideDarkModeToggle).toBe(false);
    });

    it('falls back to a generic title', () => {
      expect(buildScalarConfig(input()).pageTitle).toBe('API Reference');
    });
  });

  describe('overrides', () => {
    it('passes a custom theme through', () => {
      expect(buildScalarConfig(input({ theme: 'kepler' })).theme).toBe('kepler');
    });

    it('hides the dark-mode toggle when requested', () => {
      expect(buildScalarConfig(input({ hideDarkModeToggle: true })).hideDarkModeToggle).toBe(true);
    });

    it('passes a custom page title through', () => {
      expect(buildScalarConfig(input({ title: 'My App API' })).pageTitle).toBe('My App API');
    });
  });

  describe('mount path', () => {
    it('returns the configured mountPath as a sibling field', () => {
      const cfg = buildScalarConfig(input({ mountPath: '/dev/api' }));
      expect(cfg.mountPath).toBe('/dev/api');
    });

    it('defaults mountPath to /api/docs', () => {
      expect(buildScalarConfig(input()).mountPath).toBe('/api/docs');
    });

    it('rejects an empty mountPath', () => {
      expect(() => buildScalarConfig(input({ mountPath: '' }))).toThrow(/mountPath/i);
    });

    it('rejects a mountPath that does not start with "/"', () => {
      expect(() => buildScalarConfig(input({ mountPath: 'docs' }))).toThrow(/mountPath/i);
    });
  });
});
