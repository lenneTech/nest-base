import { describe, expect, it } from 'vitest';

import { ParallelSignupRegistry } from '../src/core/auth/parallel-operation.js';

/**
 * Adapted from nest-server `auth-parallel-operation.e2e-spec.ts`.
 *
 * Two concurrent sign-ups using the same email must not both create
 * users — one wins, one fails with `CORE_CONFLICT`. The registry pins
 * the in-process invariant before the DB unique-index does the same.
 */
describe('Auth · Parallel operation', () => {
  it('only one of two parallel signups for the same email reserves the slot', async () => {
    const reg = new ParallelSignupRegistry();
    const email = 'alice@test.com';
    const [a, b] = await Promise.all([reg.tryReserve(email), reg.tryReserve(email)]);
    const wins = [a, b].filter((r) => r === 'reserved').length;
    expect(wins).toBe(1);
  });

  it('release() lets a different request reuse the slot afterwards', async () => {
    const reg = new ParallelSignupRegistry();
    const email = 'bob@test.com';
    expect(await reg.tryReserve(email)).toBe('reserved');
    reg.release(email);
    expect(await reg.tryReserve(email)).toBe('reserved');
  });

  it('parallel signups for different emails both succeed', async () => {
    const reg = new ParallelSignupRegistry();
    const [a, b] = await Promise.all([reg.tryReserve('a@test.com'), reg.tryReserve('b@test.com')]);
    expect([a, b]).toEqual(['reserved', 'reserved']);
  });
});
