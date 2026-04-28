/**
 * Catalog of supported authentication scenarios.
 *
 * The running-app E2E suite (next slices) walks through each scenario
 * end-to-end. Listing them here gives the documentation + the e2e
 * harness one source of truth.
 */

export const AUTH_SCENARIOS = [
  'email-password-signup',
  'email-password-signin',
  'email-password-signin-wrong-password',
  'session-refresh',
  'sign-out',
  'password-reset',
  'email-verification',
] as const;

export type AuthScenario = (typeof AUTH_SCENARIOS)[number];

export function isKnownAuthScenario(value: string): value is AuthScenario {
  return (AUTH_SCENARIOS as readonly string[]).includes(value);
}
