/**
 * Story · field-encryption config planner (CF.SEC.01 — iter-117).
 * Pure planner — parses the FIELD_ENCRYPTION_MODEL_FIELDS env-var
 * shape into the Record<string, readonly string[]> the
 * `buildFieldEncryptionExtension` consumes.
 */
import { describe, expect, it } from "vitest";

import { parseFieldEncryptionMap } from "../../src/core/encryption/field-encryption-config.js";

describe("Story · parseFieldEncryptionMap", () => {
  it("returns an empty map for undefined / empty input", () => {
    expect(parseFieldEncryptionMap(undefined)).toEqual({});
    expect(parseFieldEncryptionMap("")).toEqual({});
    expect(parseFieldEncryptionMap("   ")).toEqual({});
  });

  it("parses a single Model.field pair", () => {
    expect(parseFieldEncryptionMap("User.profile_note")).toEqual({
      User: ["profile_note"],
    });
  });

  it("groups multiple fields under the same model", () => {
    expect(parseFieldEncryptionMap("User.note, User.address, User.phone")).toEqual({
      User: ["note", "address", "phone"],
    });
  });

  it("supports multiple models in one env-var", () => {
    expect(parseFieldEncryptionMap("User.note, Tenant.api_key")).toEqual({
      User: ["note"],
      Tenant: ["api_key"],
    });
  });

  it("dedupes repeated entries per model", () => {
    expect(parseFieldEncryptionMap("User.note, User.note, User.note")).toEqual({
      User: ["note"],
    });
  });

  it("trims whitespace around model + field names", () => {
    expect(parseFieldEncryptionMap("  User  .  note  ,  Tenant.api_key  ")).toEqual({
      User: ["note"],
      Tenant: ["api_key"],
    });
  });

  it("ignores malformed pairs (no dot / leading dot / trailing dot / empty halves)", () => {
    expect(parseFieldEncryptionMap("User, .note, User., , User..note,")).toEqual({});
  });

  it("survives a trailing comma without throwing", () => {
    expect(parseFieldEncryptionMap("User.note,")).toEqual({ User: ["note"] });
  });
});
