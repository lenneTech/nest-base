import { describe, expect, it } from 'vitest';

import { FeaturesSchema } from '../../src/core/features/features.js';
import {
  buildDiagnosticsReport,
  type DiagnosticsInput,
} from '../../src/core/dx/diagnostics.js';

/**
 * Story · Diagnostics endpoint (PLAN.md §27 + §32 Phase 8).
 *
 * Pure assembler that collects every signal the `/dev/diagnostics`
 * endpoint shows — process info, runtime, memory, active features,
 * dependency versions, recent boot timing — into a structured
 * report. The controller serves the result as JSON; an admin
 * pastes it into a bug report when something looks off in prod.
 *
 * Keeping the assembler I/O-free lets us:
 *   - test every section of the report deterministically
 *   - inject `now`, `processStartTime`, and `os` clones so the suite
 *     never depends on machine state
 *   - reuse the same builder in test fixtures, the dev controller,
 *     and the future diagnostics MCP-tool surface
 */
describe('Story · Diagnostics report', () => {
  function input(overrides: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
    return {
      now: () => 1_700_000_000_000,
      processStartTime: 1_699_999_900_000,
      memory: () => ({ rss: 100, heapTotal: 80, heapUsed: 50, external: 5, arrayBuffers: 2 }),
      env: {
        nodeVersion: 'v22.0.0',
        bunVersion: '1.3.2',
        platform: 'darwin',
        arch: 'arm64',
      },
      app: {
        env: 'development',
        version: '0.0.0',
        baseUrl: 'http://localhost:3000',
      },
      features: FeaturesSchema.parse({}),
      dependencies: { 'better-auth': '1.6.9', 'zod': '4.3.6' },
      ...overrides,
    };
  }

  describe('top-level shape', () => {
    it('emits the major sections', () => {
      const report = buildDiagnosticsReport(input());
      expect(report).toHaveProperty('app');
      expect(report).toHaveProperty('runtime');
      expect(report).toHaveProperty('process');
      expect(report).toHaveProperty('features');
      expect(report).toHaveProperty('dependencies');
    });

    it('marks itself as the diagnostics-report shape so tooling can pin the version', () => {
      const report = buildDiagnosticsReport(input());
      expect(report.kind).toBe('diagnostics-report');
      expect(report.version).toBe(1);
    });
  });

  describe('app section', () => {
    it('forwards env / version / baseUrl', () => {
      const report = buildDiagnosticsReport(
        input({ app: { env: 'production', version: '1.2.3', baseUrl: 'https://api.example.com' } }),
      );
      expect(report.app).toEqual({ env: 'production', version: '1.2.3', baseUrl: 'https://api.example.com' });
    });
  });

  describe('runtime section', () => {
    it('forwards node + bun + platform + arch', () => {
      const report = buildDiagnosticsReport(input());
      expect(report.runtime.nodeVersion).toBe('v22.0.0');
      expect(report.runtime.bunVersion).toBe('1.3.2');
      expect(report.runtime.platform).toBe('darwin');
      expect(report.runtime.arch).toBe('arm64');
    });

    it('omits bunVersion when not provided (Node-only deployments)', () => {
      const report = buildDiagnosticsReport(
        input({
          env: { nodeVersion: 'v22.0.0', platform: 'linux', arch: 'x64' },
        }),
      );
      expect(report.runtime.bunVersion).toBeUndefined();
      expect(report.runtime.nodeVersion).toBe('v22.0.0');
    });
  });

  describe('process section', () => {
    it('computes uptime in seconds from now() and processStartTime', () => {
      const report = buildDiagnosticsReport(
        input({
          now: () => 1_700_000_100_000,
          processStartTime: 1_700_000_000_000,
        }),
      );
      expect(report.process.uptimeSeconds).toBe(100);
    });

    it('forwards memory snapshot', () => {
      const report = buildDiagnosticsReport(input());
      expect(report.process.memory).toEqual({ rss: 100, heapTotal: 80, heapUsed: 50, external: 5, arrayBuffers: 2 });
    });

    it('records the now() timestamp as ISO so logs line up across services', () => {
      const report = buildDiagnosticsReport(input({ now: () => Date.parse('2026-04-28T10:00:00Z') }));
      expect(report.process.now).toBe('2026-04-28T10:00:00.000Z');
    });
  });

  describe('features section', () => {
    it('flattens which feature toggles are on', () => {
      const features = FeaturesSchema.parse({
        webhooks: { enabled: true },
        search: { enabled: true },
        powerSync: { enabled: false },
      });
      const report = buildDiagnosticsReport(input({ features }));
      expect(report.features.webhooks).toBe(true);
      expect(report.features.search).toBe(true);
      expect(report.features.powerSync).toBe(false);
    });

    it('reports authMethods as a sorted string array', () => {
      const features = FeaturesSchema.parse({
        authMethods: {
          emailPassword: true,
          twoFactor: true,
          passkey: false,
          apiKeys: true,
          socialProviders: ['github', 'google'],
        },
      });
      const report = buildDiagnosticsReport(input({ features }));
      expect(report.features.authMethods).toEqual(['apiKeys', 'emailPassword', 'twoFactor']);
      expect(report.features.socialProviders).toEqual(['github', 'google']);
    });
  });

  describe('dependencies section', () => {
    it('passes through the supplied dependency map', () => {
      const report = buildDiagnosticsReport(input({ dependencies: { 'foo': '1.0.0', 'bar': '2.0.0' } }));
      expect(report.dependencies).toEqual({ foo: '1.0.0', bar: '2.0.0' });
    });

    it('returns an empty object when not provided', () => {
      const report = buildDiagnosticsReport(input({ dependencies: undefined }));
      expect(report.dependencies).toEqual({});
    });
  });

  describe('determinism', () => {
    it('returns byte-identical reports for byte-identical inputs', () => {
      const a = buildDiagnosticsReport(input());
      const b = buildDiagnosticsReport(input());
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });

  describe('validation', () => {
    it('rejects a negative uptime (clock skew between now and processStartTime)', () => {
      expect(() =>
        buildDiagnosticsReport(input({ now: () => 1_000, processStartTime: 2_000 })),
      ).toThrow(/uptime/i);
    });
  });
});
