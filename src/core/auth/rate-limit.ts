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
