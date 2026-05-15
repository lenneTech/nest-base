import { describe, expect, it } from "vitest";

/**
 * Story · KEK rotation: existing rows decrypt under new key (SC.SUB.12 / CF.SEC.02).
 *
 * The PRD's `SC.SUB.12` requires that after a KEK rotation,
 * existing ciphertext (encrypted under the *previous* KEK) still
 * decrypts. Without multi-KEK support, an operator can't rotate
 * the master key without first re-encrypting every row — a step
 * that's frequently impractical for large datasets.
 *
 * The contract `MultiKekFieldEncryption` provides:
 *   - `encrypt(plaintext)` always uses the **primary** KEK.
 *   - `decrypt(ct)` tries the primary first, then iterates legacy
 *     KEKs in order. The first one that yields a valid decryption
 *     wins. Authentication tag mismatches surface as a final
 *     decrypt failure when *no* KEK succeeds.
 *
 * Rotation procedure for operators:
 *   1. Add the new KEK as the primary; demote the old one to legacy.
 *   2. Deploy. New rows encrypt under the new KEK; old rows still
 *      decrypt under the legacy slot.
 *   3. Optionally run a background re-encryption pass to migrate
 *      legacy rows. Once migrated, the legacy slot can be removed
 *      on the next rotation.
 *
 * The implementation wraps `FieldEncryptionService` (single-KEK)
 * by instantiating one service per slot and trying them in order.
 */
describe("Story · KEK rotation (SC.SUB.12)", () => {
  const KEK_A = Buffer.alloc(32, 0xa1);
  const KEK_B = Buffer.alloc(32, 0xb2);
  const KEK_C = Buffer.alloc(32, 0xc3);

  it("encrypts under the primary KEK", async () => {
    const { MultiKekFieldEncryption } =
      await import("../../src/core/encryption/multi-kek.service.js");
    const { FieldEncryptionService } =
      await import("../../src/core/encryption/field-encryption.service.js");
    const multi = new MultiKekFieldEncryption({
      primary: { getKek: () => KEK_A },
      legacy: [],
    });
    const ct = multi.encrypt("hello");
    // The same primary-keyed service decrypts the same value verbatim.
    const single = new FieldEncryptionService({ getKek: () => KEK_A });
    expect(single.decrypt(ct)).toBe("hello");
  });

  it("decrypts ciphertext encrypted under a legacy KEK after rotation", async () => {
    const { MultiKekFieldEncryption } =
      await import("../../src/core/encryption/multi-kek.service.js");
    const { FieldEncryptionService } =
      await import("../../src/core/encryption/field-encryption.service.js");

    // Pre-rotation: row was encrypted under KEK_A.
    const old = new FieldEncryptionService({ getKek: () => KEK_A });
    const ctOld = old.encrypt("legacy row");

    // After rotation: KEK_B is primary, KEK_A is legacy.
    const multi = new MultiKekFieldEncryption({
      primary: { getKek: () => KEK_B },
      legacy: [{ getKek: () => KEK_A }],
    });

    expect(multi.decrypt(ctOld)).toBe("legacy row");
  });

  it("encrypts new rows under the new primary, not the legacy", async () => {
    const { MultiKekFieldEncryption } =
      await import("../../src/core/encryption/multi-kek.service.js");
    const { FieldEncryptionService } =
      await import("../../src/core/encryption/field-encryption.service.js");

    const multi = new MultiKekFieldEncryption({
      primary: { getKek: () => KEK_B },
      legacy: [{ getKek: () => KEK_A }],
    });
    const ctNew = multi.encrypt("fresh row");

    // The new ciphertext must not decrypt under the legacy KEK.
    const legacyOnly = new FieldEncryptionService({ getKek: () => KEK_A });
    expect(() => legacyOnly.decrypt(ctNew)).toThrow();

    // It does decrypt under the primary.
    const primaryOnly = new FieldEncryptionService({ getKek: () => KEK_B });
    expect(primaryOnly.decrypt(ctNew)).toBe("fresh row");
  });

  it("supports multiple legacy KEKs in order", async () => {
    const { MultiKekFieldEncryption } =
      await import("../../src/core/encryption/multi-kek.service.js");
    const { FieldEncryptionService } =
      await import("../../src/core/encryption/field-encryption.service.js");

    const oldA = new FieldEncryptionService({ getKek: () => KEK_A });
    const oldB = new FieldEncryptionService({ getKek: () => KEK_B });
    const ctA = oldA.encrypt("from key A");
    const ctB = oldB.encrypt("from key B");

    const multi = new MultiKekFieldEncryption({
      primary: { getKek: () => KEK_C },
      legacy: [{ getKek: () => KEK_B }, { getKek: () => KEK_A }],
    });

    expect(multi.decrypt(ctA)).toBe("from key A");
    expect(multi.decrypt(ctB)).toBe("from key B");
  });

  it("throws when no KEK in the chain can decrypt", async () => {
    const { MultiKekFieldEncryption } =
      await import("../../src/core/encryption/multi-kek.service.js");
    const { FieldEncryptionService } =
      await import("../../src/core/encryption/field-encryption.service.js");

    const stranger = new FieldEncryptionService({ getKek: () => Buffer.alloc(32, 0xff) });
    const ctStranger = stranger.encrypt("not yours");

    const multi = new MultiKekFieldEncryption({
      primary: { getKek: () => KEK_A },
      legacy: [{ getKek: () => KEK_B }],
    });

    expect(() => multi.decrypt(ctStranger)).toThrow(/no kek/i);
  });

  it("primary KEK is tried first (skips legacy iteration when primary works)", async () => {
    const { MultiKekFieldEncryption } =
      await import("../../src/core/encryption/multi-kek.service.js");

    // Inject a legacy KEK that throws if invoked — proves primary path was used.
    let legacyCalled = 0;
    const multi = new MultiKekFieldEncryption({
      primary: { getKek: () => KEK_A },
      legacy: [
        {
          getKek: () => {
            legacyCalled++;
            return KEK_B;
          },
        },
      ],
    });
    const ct = multi.encrypt("primary-path");
    expect(multi.decrypt(ct)).toBe("primary-path");
    // Decrypt didn't have to fall back to legacy — the legacy KEK getter
    // is therefore never invoked during the successful decrypt.
    expect(legacyCalled).toBe(0);
  });

  describe("MIN-2 · malformed ciphertext vs wrong-key distinction", () => {
    it("throws CiphertextMalformedError immediately for structurally invalid ciphertext", async () => {
      const { MultiKekFieldEncryption, CiphertextMalformedError } =
        await import("../../src/core/encryption/multi-kek.service.js");

      let legacyCalled = 0;
      const multi = new MultiKekFieldEncryption({
        primary: { getKek: () => KEK_A },
        legacy: [
          {
            getKek: () => {
              legacyCalled++;
              return KEK_B;
            },
          },
        ],
      });

      // Structurally invalid: no v1: prefix.
      expect(() => multi.decrypt("not-a-ciphertext")).toThrow(CiphertextMalformedError);
      // Legacy KEKs must NOT be tried for malformed ciphertext.
      expect(legacyCalled).toBe(0);
    });

    it("throws CiphertextMalformedError for a wrong version prefix", async () => {
      const { MultiKekFieldEncryption, CiphertextMalformedError } =
        await import("../../src/core/encryption/multi-kek.service.js");
      const multi = new MultiKekFieldEncryption({ primary: { getKek: () => KEK_A }, legacy: [] });
      expect(() => multi.decrypt("v9:somebase64payload")).toThrow(CiphertextMalformedError);
    });

    it("throws MultiKekDecryptError (not CiphertextMalformedError) for a valid format but wrong key", async () => {
      const { MultiKekFieldEncryption, MultiKekDecryptError, CiphertextMalformedError } =
        await import("../../src/core/encryption/multi-kek.service.js");
      const { FieldEncryptionService } =
        await import("../../src/core/encryption/field-encryption.service.js");

      // Encrypt under an unknown key.
      const stranger = new FieldEncryptionService({ getKek: () => Buffer.alloc(32, 0xdd) });
      const ct = stranger.encrypt("secret");

      const multi = new MultiKekFieldEncryption({ primary: { getKek: () => KEK_A }, legacy: [] });
      // Well-formed ciphertext but wrong key → MultiKekDecryptError, not CiphertextMalformedError.
      expect(() => multi.decrypt(ct)).toThrow(MultiKekDecryptError);
      expect(() => multi.decrypt(ct)).not.toThrow(CiphertextMalformedError);
    });
  });
});
