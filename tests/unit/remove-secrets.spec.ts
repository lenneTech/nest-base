import { describe, expect, it } from "vitest";

import {
  removeSecrets,
  DEFAULT_SECRET_KEYS,
} from "../../src/core/output-pipeline/remove-secrets.js";

/**
 * Adapted from nest-server `remove-secrets.spec.ts`.
 *
 * Output-Pipeline Stage 3 — strips known secret-shaped keys from
 * outbound payloads. Stage 4 (`safety-net`) is the regression-catcher
 * that runs AFTER this; the two complement each other.
 */
describe("Output-Pipeline · removeSecrets()", () => {
  it("strips top-level secret keys", () => {
    const result = removeSecrets({ id: "1", password: "p", token: "t" });
    expect(result).toEqual({ id: "1" });
  });

  it("walks nested objects", () => {
    const result = removeSecrets({ user: { id: "1", password: "p" } }) as { user: object };
    expect(result.user).toEqual({ id: "1" });
  });

  it("walks arrays", () => {
    const result = removeSecrets([
      { id: "1", secret: "s" },
      { id: "2", token: "t" },
    ]) as unknown[];
    expect(result).toEqual([{ id: "1" }, { id: "2" }]);
  });

  it("does not mutate the input", () => {
    const input = { id: "1", password: "p" };
    removeSecrets(input);
    expect(input).toEqual({ id: "1", password: "p" });
  });

  it("case-insensitive match", () => {
    const result = removeSecrets({ Password: "p", AUTH_TOKEN: "t" });
    expect(result).toEqual({});
  });

  it("honors a custom keys list", () => {
    const result = removeSecrets({ pinHash: "abc", email: "x@y.com" }, ["pinHash"]);
    expect(result).toEqual({ email: "x@y.com" });
  });

  it("exposes the default list", () => {
    expect(DEFAULT_SECRET_KEYS).toEqual(
      expect.arrayContaining(["password", "passwordHash", "token", "apiKey", "secret"]),
    );
  });

  it("returns primitives unchanged", () => {
    expect(removeSecrets(null)).toBeNull();
    expect(removeSecrets("hi")).toBe("hi");
    expect(removeSecrets(42)).toBe(42);
  });
});
