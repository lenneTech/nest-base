/**
 * Shared helper that determines whether cookies should carry the `Secure`
 * flag in the current environment.
 *
 * Previously this condition was inlined separately in `bootstrap.ts` and
 * `hub.controller.ts` with a subtle divergence: `hub.controller.ts` was
 * missing the `!== "test"` branch, which meant staging test suites that
 * set `NODE_ENV=test` would still receive the secure flag from the hub
 * login route but not from the refresh path in bootstrap.ts (Finding 8 fix).
 *
 * Both callers now import this function so the two cookie-security checks
 * stay in sync automatically.
 */
export function isSecureCookieEnv(): boolean {
  return process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test";
}
