/**
 * Pure pinning helper for the test-runner's NODE_ENV.
 *
 * Bun auto-loads `.env` at process start, so a workspace whose `.env`
 * declares `NODE_ENV=development` will boot Vitest with that value
 * baked in. The legacy contract — "globalSetup writes
 * `process.env.NODE_ENV = 'test'`" — proved leaky: when Vitest forks
 * workers under `pool: 'forks'`, the env-pinning race against module
 * load order in each worker manifests as the
 * `tests/unit/test-infrastructure.spec.ts > "exposes NODE_ENV=test"`
 * assertion failing on a fresh consumer.
 *
 * `pinTestNodeEnv()` is the pure helper invoked by both the
 * `globalSetup` hook and the per-worker `setupFiles` entry. The hook
 * approach matches the existing `with-node-env.ts` discipline (the
 * pinner mutates the supplied object; the caller decides whether
 * that's `process.env` or a sandbox in tests).
 */

export function pinTestNodeEnv(env: Record<string, string | undefined>): void {
  // Single line of behaviour: regardless of what came in (including
  // 'production' from a misconfigured CI), the test process speaks for
  // the test runner. Comparing identity ('test' === 'test') is a free
  // micro-opt that also keeps re-pin idempotent.
  if (env.NODE_ENV !== "test") {
    env.NODE_ENV = "test";
  }
}
