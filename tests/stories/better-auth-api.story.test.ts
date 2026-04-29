import { describe, expect, it } from "vitest";

import {
  BetterAuthConfigSchema,
  betterAuthConfigDefaults,
} from "../../src/core/auth/better-auth-config.js";

/**
 * Story · Better-Auth API surface
 *
 * Pins the configuration surface that the Better-Auth integration layer
 * (next slice: "Better-Auth Integration") consumes. Running-app E2E
 * for /signup, /signin, /signout grows on top of this once the
 * integration lands.
 */
describe("Story · Better-Auth API config", () => {
  it("defaults expose email-password + session lifetime", () => {
    const cfg = betterAuthConfigDefaults();
    expect(cfg.emailAndPassword.enabled).toBe(true);
    expect(cfg.session.expiresInSeconds).toBeGreaterThan(0);
  });

  it("rejects negative session lifetime", () => {
    const result = BetterAuthConfigSchema.safeParse({
      emailAndPassword: { enabled: true },
      session: { expiresInSeconds: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("default session lifetime is at least 24 hours", () => {
    expect(betterAuthConfigDefaults().session.expiresInSeconds).toBeGreaterThanOrEqual(
      60 * 60 * 24,
    );
  });
});
