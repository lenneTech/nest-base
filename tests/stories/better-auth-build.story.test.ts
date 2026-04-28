import { describe, expect, it } from 'vitest';

import { buildBetterAuth } from '../../src/core/auth/better-auth.js';

/**
 * Story · Better-Auth integration (factory).
 *
 * The factory accepts the validated config (PLAN.md §4) and returns
 * a Better-Auth instance whose `handler` is what the NestJS adapter
 * mounts under `/api/auth/*`. Tests stay unit-level: no DB tables, no
 * network, just the construction surface.
 */
describe('Story · Better-Auth integration / factory', () => {
  it('buildBetterAuth() returns an object with a callable `handler`', () => {
    const auth = buildBetterAuth({
      secret: 'a'.repeat(32),
      baseUrl: 'http://localhost:3000',
      sessionExpiresInSeconds: 60 * 60 * 24,
    });
    expect(auth).toBeDefined();
    expect(typeof auth.handler).toBe('function');
  });

  it('the instance exposes the resolved mount path under `options.basePath`', () => {
    const auth = buildBetterAuth({
      secret: 'a'.repeat(32),
      baseUrl: 'http://localhost:3000',
      sessionExpiresInSeconds: 60,
    });
    expect(auth.options.basePath ?? '/api/auth').toBe('/api/auth');
  });

  it('rejects a baseUrl that is not parseable', () => {
    expect(() =>
      buildBetterAuth({
        secret: 'a'.repeat(32),
        baseUrl: 'not-a-url',
        sessionExpiresInSeconds: 60,
      }),
    ).toThrow();
  });

  it('rejects a secret shorter than 32 chars (auth invariants)', () => {
    expect(() =>
      buildBetterAuth({
        secret: 'short',
        baseUrl: 'http://localhost:3000',
        sessionExpiresInSeconds: 60,
      }),
    ).toThrow(/secret/i);
  });
});
