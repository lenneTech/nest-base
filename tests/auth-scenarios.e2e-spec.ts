import { describe, expect, it } from "vitest";

import { AUTH_SCENARIOS, isKnownAuthScenario } from "../src/core/auth/auth-scenarios.js";

/**
 * Adapted from nest-server `auth-scenarios.e2e-spec.ts`.
 *
 * Documents the supported authentication scenarios. Each scenario is
 * a discrete user journey that the running-app E2E exercises end-to-end
 * once Better-Auth lands.
 */
describe("Auth · Scenarios catalog", () => {
  it("catalogs at least the core scenarios", () => {
    expect(AUTH_SCENARIOS).toEqual(
      expect.arrayContaining([
        "email-password-signup",
        "email-password-signin",
        "email-password-signin-wrong-password",
        "session-refresh",
        "sign-out",
        "password-reset",
        "email-verification",
      ]),
    );
  });

  it("isKnownAuthScenario() rejects unknown scenarios", () => {
    expect(isKnownAuthScenario("email-password-signup")).toBe(true);
    expect(isKnownAuthScenario("teleport-login")).toBe(false);
  });
});
