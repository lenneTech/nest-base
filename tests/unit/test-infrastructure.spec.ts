import { describe, expect, it } from 'vitest';

/**
 * Smoke test for the test infrastructure itself.
 *
 * Verifies that the global-setup (`tests/global-setup.ts`) ran and exposed
 * a `DATABASE_URL` for downstream tests. Without this, no e2e/story test
 * can talk to the database.
 */
describe('Test-Infrastructure', () => {
  it('exposes DATABASE_URL after global-setup ran', () => {
    expect(process.env.DATABASE_URL).toBeDefined();
    expect(process.env.DATABASE_URL).toMatch(/^postgres(?:ql)?:\/\//);
  });

  it('exposes NODE_ENV=test for downstream guards', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('marks infrastructure as ready via TEST_INFRA_READY flag', () => {
    expect(process.env.TEST_INFRA_READY).toBe('1');
  });
});
