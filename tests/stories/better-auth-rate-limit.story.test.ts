import { describe, expect, it } from 'vitest';

import { defaultAuthRateLimits, type AuthRateLimitWindow } from '../../src/core/auth/rate-limit.js';

/**
 * Story · Better-Auth rate limits
 *
 * Per-endpoint rate-limit windows for the auth surface (sign-in,
 * sign-up, password-reset, verify-email). Numbers come from PLAN.md
 * §1 + Better-Auth recommendations.
 */
describe('Story · Better-Auth rate limits', () => {
  it('exposes a window for sign-in', () => {
    const window: AuthRateLimitWindow = defaultAuthRateLimits().signIn;
    expect(window.maxRequests).toBeGreaterThan(0);
    expect(window.windowSeconds).toBeGreaterThan(0);
  });

  it('sign-in is stricter than sign-up (login attacks > registration attacks)', () => {
    const limits = defaultAuthRateLimits();
    const signInPerMinute = limits.signIn.maxRequests / limits.signIn.windowSeconds;
    const signUpPerMinute = limits.signUp.maxRequests / limits.signUp.windowSeconds;
    expect(signInPerMinute).toBeLessThanOrEqual(signUpPerMinute);
  });

  it('password-reset is the strictest window', () => {
    const limits = defaultAuthRateLimits();
    const resetPerMinute = limits.passwordReset.maxRequests / limits.passwordReset.windowSeconds;
    const signInPerMinute = limits.signIn.maxRequests / limits.signIn.windowSeconds;
    expect(resetPerMinute).toBeLessThanOrEqual(signInPerMinute);
  });
});
