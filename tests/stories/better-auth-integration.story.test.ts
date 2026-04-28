import { describe, expect, it } from 'vitest';

import { resolveBetterAuthMountPath } from '../../src/core/auth/better-auth-config.js';

/**
 * Story · Better-Auth integration / mount path
 *
 * The Better-Auth handlers are mounted under a single base path. The
 * default lives in this helper so both the NestJS adapter and the SDK
 * generator agree.
 */
describe('Story · Better-Auth integration', () => {
  it('default mount path is /api/auth', () => {
    expect(resolveBetterAuthMountPath()).toBe('/api/auth');
  });

  it('honors a custom mount path when provided', () => {
    expect(resolveBetterAuthMountPath('/auth')).toBe('/auth');
  });

  it('rejects mount paths that do not start with a slash', () => {
    expect(() => resolveBetterAuthMountPath('auth')).toThrow();
  });
});
