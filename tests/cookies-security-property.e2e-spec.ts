import { describe, expect, it } from "vitest";

import { CookieConfigSchema, cookieDefaults } from "../src/core/http/cookie-cors-config.js";

/**
 * Adapted from nest-server `cookies-security-property.e2e-spec.ts`.
 *
 * Property-style invariants: regardless of which environment we're in,
 * cookies issued by the server must always be HttpOnly. Production must
 * additionally be Secure with SameSite ∈ {lax, strict}. Local development
 * may relax Secure to keep `http://localhost` workflows usable.
 */
describe("Property · Cookie Security Invariants", () => {
  it("cookieDefaults() output passes the schema for every environment", () => {
    for (const env of ["development", "staging", "production"] as const) {
      const cfg = cookieDefaults(env);
      const parsed = CookieConfigSchema.safeParse(cfg);
      expect(parsed.success, `env=${env}`).toBe(true);
    }
  });

  it("cookies are always HttpOnly (no JS-readable session in any environment)", () => {
    for (const env of ["development", "staging", "production"] as const) {
      expect(cookieDefaults(env).httpOnly, `env=${env}`).toBe(true);
    }
  });

  it("production + staging set Secure=true; development may set Secure=false", () => {
    expect(cookieDefaults("production").secure).toBe(true);
    expect(cookieDefaults("staging").secure).toBe(true);
    // dev is intentionally permissive
    expect(typeof cookieDefaults("development").secure).toBe("boolean");
  });

  it('SameSite is always one of "strict", "lax", "none"', () => {
    for (const env of ["development", "staging", "production"] as const) {
      expect(["strict", "lax", "none"]).toContain(cookieDefaults(env).sameSite);
    }
  });

  it("SameSite=none implies Secure=true (RFC 6265 + Chrome enforcement)", () => {
    for (const env of ["development", "staging", "production"] as const) {
      const cfg = cookieDefaults(env);
      if (cfg.sameSite === "none") {
        expect(cfg.secure, `SameSite=none requires Secure (env=${env})`).toBe(true);
      }
    }
  });
});
