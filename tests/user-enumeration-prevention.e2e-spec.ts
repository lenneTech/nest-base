import { describe, expect, it } from 'vitest';

import { maskUserExistenceResponse, constantTimeEquals } from '../src/core/auth/user-enumeration.js';

/**
 * Adapted from nest-server `user-enumeration-prevention.e2e-spec.ts`.
 *
 * The auth surface must produce indistinguishable responses for "user
 * exists" vs "user does not exist". The helpers here are the building
 * blocks the controllers consume:
 *   - `maskUserExistenceResponse()` returns the same shape regardless
 *   - `constantTimeEquals()` compares secrets without leaking timing
 */
describe('User enumeration prevention', () => {
  it('maskUserExistenceResponse() returns the same shape for existing + missing users', () => {
    const existing = maskUserExistenceResponse({ email: 'alice@test.com', userExists: true });
    const missing = maskUserExistenceResponse({ email: 'bob@test.com', userExists: false });
    expect(Object.keys(existing).sort()).toEqual(Object.keys(missing).sort());
    expect(existing.message).toEqual(missing.message);
  });

  it('the masked message is generic and does not reveal existence', () => {
    const existing = maskUserExistenceResponse({ email: 'alice@test.com', userExists: true });
    expect(existing.message).not.toMatch(/exists|does not exist|not found|registered/i);
  });

  it('constantTimeEquals() returns true for identical strings', () => {
    expect(constantTimeEquals('secret', 'secret')).toBe(true);
  });

  it('constantTimeEquals() returns false for different lengths', () => {
    expect(constantTimeEquals('a', 'ab')).toBe(false);
  });

  it('constantTimeEquals() returns false for differing strings of same length', () => {
    expect(constantTimeEquals('aaaa', 'bbbb')).toBe(false);
  });
});
