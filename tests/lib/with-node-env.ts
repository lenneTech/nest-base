/**
 * Sanctioned wrapper for `process.env.NODE_ENV` mutations inside specs.
 *
 * Why this helper exists:
 *
 * Several e2e specs flip `NODE_ENV` mid-suite to test production /
 * development behaviour. They reset in `afterAll`, but if the spec
 * fails BEFORE the reset runs, `NODE_ENV` leaks to every spec that
 * runs after it in the same Vitest worker. Concretely, when a spec
 * leaves `NODE_ENV=development`, `parseTestAbilityHeader` early-returns
 * for the rest of the worker — and every subsequent test that relies
 * on the `X-Test-Ability` hatch silently 403s.
 *
 * `withNodeEnv(value, fn)` always restores the previous value via
 * `try/finally`, so a thrown assertion inside `fn` no longer poisons
 * the worker. The companion runtime-side defence is in
 * `src/core/permissions/test-ability.ts`, which caches `NODE_ENV`
 * once at module load.
 *
 * Usage:
 *
 * ```ts
 * await withNodeEnv("development", async () => {
 *   const app = await bootstrap({ listen: false });
 *   const res = await request(app.getHttpServer()).get("/dev-only");
 *   expect(res.status).toBe(200);
 * });
 * ```
 */
export async function withNodeEnv<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previous;
    }
  }
}

/**
 * Synchronous variant for hot loops that absolutely cannot await.
 *
 * Prefer the async `withNodeEnv` whenever possible — most call sites
 * already live inside an `async` test. Reach for this helper only
 * when wrapping pure synchronous code (e.g. directly invoking a
 * planner that reads `process.env.NODE_ENV`).
 */
export function withNodeEnvSync<T>(value: string, fn: () => T): T {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previous;
    }
  }
}
