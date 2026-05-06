import { describe, expect, it } from "vitest";

import { parseLegacyKeks } from "../../src/core/encryption/legacy-kek-config.js";

/**
 * Story · `parseLegacyKeks` (CF.SEC.02 / SC.SUB.12 prep — iter-188).
 *
 * Pure planner that reads `FIELD_ENCRYPTION_LEGACY_KEKS` (comma-
 * separated base64-encoded 32-byte AES-256 keys) and returns the
 * decoded buffers. Whitespace is trimmed, empty entries are dropped,
 * malformed entries throw at boot — KEK rotation is a security
 * boundary, fail-fast is the right default.
 *
 * Order matters: the legacy KEKs are tried in the order they appear
 * in the env-var, so operators can stage rotation by listing the
 * most-recent legacy first (highest hit rate during ciphertext
 * migration).
 */
describe("Story · parseLegacyKeks (iter-188 — CF.SEC.02 / SC.SUB.12)", () => {
  // 32 random bytes, base64-encoded (= 44 chars with `=` padding).
  const KEK_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const KEK_B = "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=";
  const KEK_C = "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=";

  it("returns an empty array when the env-var is undefined", () => {
    expect(parseLegacyKeks(undefined)).toEqual([]);
  });

  it("returns an empty array on an empty string", () => {
    expect(parseLegacyKeks("")).toEqual([]);
  });

  it("returns a single-entry array when one KEK is configured", () => {
    const result = parseLegacyKeks(KEK_A);
    expect(result).toHaveLength(1);
    expect(result[0]?.length).toBe(32);
  });

  it("preserves declaration order across multiple comma-separated KEKs", () => {
    const result = parseLegacyKeks(`${KEK_A},${KEK_B},${KEK_C}`);
    expect(result).toHaveLength(3);
    // Each KEK is exactly 32 bytes — the AES-256 contract.
    for (const buf of result) {
      expect(buf.length).toBe(32);
    }
    // Order matches input — operators can stage rotation by listing
    // the most-recent legacy first.
    expect(result[0]?.toString("base64")).toBe(KEK_A);
    expect(result[1]?.toString("base64")).toBe(KEK_B);
    expect(result[2]?.toString("base64")).toBe(KEK_C);
  });

  it("trims whitespace around each entry", () => {
    const result = parseLegacyKeks(` ${KEK_A} ,  ${KEK_B}  `);
    expect(result).toHaveLength(2);
    expect(result[0]?.toString("base64")).toBe(KEK_A);
    expect(result[1]?.toString("base64")).toBe(KEK_B);
  });

  it("drops empty entries from a stray-comma input (defensive)", () => {
    const result = parseLegacyKeks(`${KEK_A},,${KEK_B},`);
    expect(result).toHaveLength(2);
  });

  it("throws when a KEK does NOT decode to exactly 32 bytes", () => {
    // 16-byte (AES-128) — half the required length.
    const SHORT_KEK = "AAAAAAAAAAAAAAAAAAAAAA==";
    expect(() => parseLegacyKeks(SHORT_KEK)).toThrow(/FIELD_ENCRYPTION_LEGACY_KEKS.*32 bytes/);
  });

  it("throws when the input is not valid base64", () => {
    // Buffer.from("!@#%", "base64") is lenient and produces empty buffer
    // rather than throwing, so the planner detects the wrong length
    // and surfaces it as a configuration error.
    expect(() => parseLegacyKeks("!@#%")).toThrow(/FIELD_ENCRYPTION_LEGACY_KEKS.*32 bytes/);
  });
});
