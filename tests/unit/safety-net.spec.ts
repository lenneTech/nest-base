import { describe, expect, it } from "vitest";

import {
  DEFAULT_SECRET_FIELD_NAMES,
  applySafetyNet,
  containsSecretField,
} from "../../src/core/output-pipeline/safety-net.js";

/**
 * Adapted from nest-server `safety-net.spec.ts`.
 *
 * Output-Pipeline Stage 4 inspects every outbound object for keys that
 * match the secret-field allowlist (password, token, hash, …). If a
 * match leaks past Stage 3 (which uses the strip-rules), this safety
 * net catches it loudly so the regression is visible in tests.
 */
describe("Output-Pipeline · Safety-Net (unit)", () => {
  it("exposes a default list with the well-known secret field names", () => {
    expect(DEFAULT_SECRET_FIELD_NAMES).toEqual(
      expect.arrayContaining(["password", "passwordHash", "token", "apiKey", "secret"]),
    );
  });

  it("containsSecretField() returns true on a top-level secret-named key", () => {
    expect(containsSecretField({ password: "p" }, DEFAULT_SECRET_FIELD_NAMES)).toBe(true);
  });

  it("containsSecretField() walks nested objects", () => {
    expect(containsSecretField({ user: { token: "abc" } }, DEFAULT_SECRET_FIELD_NAMES)).toBe(true);
  });

  it("containsSecretField() walks arrays", () => {
    expect(containsSecretField([{ secret: "s" }], DEFAULT_SECRET_FIELD_NAMES)).toBe(true);
  });

  it("containsSecretField() is case-insensitive", () => {
    expect(containsSecretField({ Password: "p" }, DEFAULT_SECRET_FIELD_NAMES)).toBe(true);
  });

  it("containsSecretField() returns false on safe payloads", () => {
    expect(containsSecretField({ id: "1", email: "a@x.com" }, DEFAULT_SECRET_FIELD_NAMES)).toBe(
      false,
    );
  });

  it("containsSecretField() handles primitives + null defensively", () => {
    expect(containsSecretField(null, DEFAULT_SECRET_FIELD_NAMES)).toBe(false);
    expect(containsSecretField("hello", DEFAULT_SECRET_FIELD_NAMES)).toBe(false);
    expect(containsSecretField(42, DEFAULT_SECRET_FIELD_NAMES)).toBe(false);
  });

  // Fix 4.1 — underscore-normalisation: auth_token and authToken are treated
  // as the same secret field name so snake_case database column names are
  // caught by the same allowlist as camelCase application keys.
  it("containsSecretField() treats auth_token and authToken as equivalent", () => {
    expect(containsSecretField({ auth_token: "secret" }, DEFAULT_SECRET_FIELD_NAMES)).toBe(true);
    expect(containsSecretField({ authToken: "secret" }, DEFAULT_SECRET_FIELD_NAMES)).toBe(true);
  });

  it("applySafetyNet() masks underscore-variant secret keys in mask mode", () => {
    const result = applySafetyNet(
      { user: "alice", auth_token: "abc123", refresh_token: "def456" },
      { mode: "mask", fields: DEFAULT_SECRET_FIELD_NAMES },
    ) as Record<string, unknown>;
    expect(result["auth_token"]).toBe("[redacted]");
    expect(result["refresh_token"]).toBe("[redacted]");
    expect(result["user"]).toBe("alice");
  });

  it("applySafetyNet() throws on underscore-variant secret keys in throw mode", () => {
    expect(() =>
      applySafetyNet(
        { auth_token: "secret" },
        { mode: "throw", fields: DEFAULT_SECRET_FIELD_NAMES },
      ),
    ).toThrow();
  });
});
