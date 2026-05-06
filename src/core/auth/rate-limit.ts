/**
 * Per-endpoint rate-limit windows for the auth surface.
 *
 * The integration layer wires these into Better-Auth + the @nestjs/throttler
 * Postgres store. Numbers reflect production defaults — projects can tune
 * via ENV-vars in a later slice.
 */

export interface AuthRateLimitWindow {
  maxRequests: number;
  windowSeconds: number;
}

export interface AuthRateLimits {
  signIn: AuthRateLimitWindow;
  signUp: AuthRateLimitWindow;
  passwordReset: AuthRateLimitWindow;
  verifyEmail: AuthRateLimitWindow;
}

/**
 * Dynamic variant that reads each auth scope from the DB via
 * `RateLimitConfigService`, falling back to the hardcoded defaults when no
 * row exists for that scope. Call this inside the Better-Auth rate-limit
 * plugin factory rather than `defaultAuthRateLimits()` so operator edits
 * take effect without a restart.
 *
 * The import is kept lazy (string interface, not a real import) so this file
 * does not create a circular dependency with the throttler module.
 */
export interface RateLimitWindowProvider {
  getWindow(scope: string): { maxRequests: number; windowSeconds: number };
}

export function dynamicAuthRateLimits(configService: RateLimitWindowProvider): AuthRateLimits {
  const get = (scope: string, fallback: AuthRateLimitWindow): AuthRateLimitWindow => {
    const w = configService.getWindow(scope);
    return w ?? fallback;
  };
  const defaults = defaultAuthRateLimits();
  return {
    signIn: get("auth:signIn", defaults.signIn),
    signUp: get("auth:signUp", defaults.signUp),
    passwordReset: get("auth:passwordReset", defaults.passwordReset),
    verifyEmail: get("auth:verifyEmail", defaults.verifyEmail),
  };
}

export function defaultAuthRateLimits(): AuthRateLimits {
  return {
    // 5 / minute per IP — strictest because credential-stuffing is the
    // top API-auth attack. Allows fat-finger retries.
    signIn: { maxRequests: 5, windowSeconds: 60 },
    // 10 / minute per IP — slightly more permissive than sign-in;
    // captcha or verification mail catches bot farming downstream.
    signUp: { maxRequests: 10, windowSeconds: 60 },
    // 3 / hour per IP — the strictest because each leaks an email
    // existence signal via the sent mail.
    passwordReset: { maxRequests: 3, windowSeconds: 60 * 60 },
    // 10 / hour per IP — verification re-sends are common but not abusive.
    verifyEmail: { maxRequests: 10, windowSeconds: 60 * 60 },
  };
}
