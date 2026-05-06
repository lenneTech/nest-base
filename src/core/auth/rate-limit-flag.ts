/**
 * `isBetterAuthRateLimitEnabled` — reads `BETTER_AUTH_RATE_LIMIT_ENABLED`
 * from the supplied env-map and returns whether the Better-Auth rate-limiter
 * should be active.
 *
 * WHY a separate helper instead of inline logic in BetterAuthModule:
 * - Keeps the decision pure and fully unit-testable without a NestJS DI
 *   context or process.env mutation.
 * - A single export makes it easy to import in both the module and the
 *   story tests.
 *
 * Default behaviour:
 *   - `false` when NODE_ENV is "test" or "development" — rapid dev/CI runs
 *     exhaust the window and generate spurious 429s, hurting DX.
 *   - `true` in all other envs (production, staging, …) — brute-force
 *     protection must be on by default where it matters.
 *
 * Override: set `BETTER_AUTH_RATE_LIMIT_ENABLED=true|false` to force a
 * specific value regardless of NODE_ENV.
 */
export function isBetterAuthRateLimitEnabled(
  env: Record<string, string | undefined>,
): boolean {
  const explicit = env["BETTER_AUTH_RATE_LIMIT_ENABLED"];
  if (explicit !== undefined) {
    return explicit !== "false";
  }
  // No explicit override — derive from NODE_ENV.
  const nodeEnv = env["NODE_ENV"] ?? "";
  return nodeEnv !== "test" && nodeEnv !== "development";
}
