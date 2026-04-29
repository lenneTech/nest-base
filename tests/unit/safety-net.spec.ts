import { describe, expect, it } from "vitest";

import {
  DEFAULT_SECRET_FIELD_NAMES,
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
});
