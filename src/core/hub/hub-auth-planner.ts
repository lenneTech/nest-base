/**
 * Hub authentication configuration planner (pure function).
 *
 * Decides whether the Hub UI requires password auth based on the
 * deployment stage. Local development is always open; every other
 * stage (test, staging, production) requires a valid session cookie.
 *
 * Cookie contract (issue #83):
 *   - HTTP-only (no JS access)
 *   - Secure flag (HTTPS only — non-local stages always run HTTPS)
 *   - SameSite=Lax (CSRF mitigation)
 *   - 8-hour sliding window
 *   - Signed (prevents client-side tampering)
 */

export type HubStage = "local" | "test" | "staging" | "production";

export interface HubCookieConfig {
  /** Cookie name. */
  name: string;
  /** HTTP-only: not accessible from JavaScript. */
  httpOnly: true;
  /** Secure flag — only sent over HTTPS. */
  secure: boolean;
  /** SameSite policy. */
  sameSite: "lax" | "strict" | "none";
  /** Max age in milliseconds (sliding window). */
  maxAgeMs: number;
  /** Whether to reset expiry on each authenticated request. */
  sliding: boolean;
  /** Whether the cookie is signed with the server's secret. */
  signed: boolean;
}

export interface HubAuthConfig {
  /** Whether the Hub requires authentication. */
  requireAuth: boolean;
  /** Cookie shape when auth is required. */
  cookie: HubCookieConfig;
}

export interface HubAuthPlannerInput {
  stage: HubStage;
}

const HUB_SESSION_COOKIE_NAME = "hub.session";
const HUB_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

/**
 * Returns the Hub authentication configuration for a given stage.
 *
 * Local stage is always open — Hub auth adds no value in a developer's
 * local environment. Non-local stages always require the password
 * session so staging and production Hubs are protected from accidental
 * exposure.
 */
export function buildHubAuthConfig(input: HubAuthPlannerInput): HubAuthConfig {
  // Non-HTTPS stages (local) can't benefit from Secure cookies; the
  // secure flag stays false there but it doesn't matter since auth is
  // disabled for local anyway.
  const isLocal = input.stage === "local";

  return {
    requireAuth: !isLocal,
    cookie: {
      name: HUB_SESSION_COOKIE_NAME,
      httpOnly: true,
      secure: !isLocal,
      sameSite: "lax",
      maxAgeMs: HUB_SESSION_MAX_AGE_MS,
      sliding: true,
      signed: true,
    },
  };
}
