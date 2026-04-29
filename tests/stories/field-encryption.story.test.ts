import { describe, expect, it } from "vitest";

import {
  EnvKekProvider,
  FieldEncryptionService,
  type KekProvider,
} from "../../src/core/encryption/index.js";

/**
 * Story · Field-Encryption-Service (PLAN.md §14)
 *
 * AES-256-GCM with a KEK sourced from a `KekProvider`. Default driver
 * reads the KEK from `FIELD_ENCRYPTION_KEK` env-var (32-byte base64).
 * The driver interface is the swap-point for Vault / KMS later (#13).
 */
describe("Story · Field-Encryption (AES-256-GCM)", () => {
  const KEY_B64 = Buffer.alloc(32, 0xab).toString("base64"); // 32 bytes
  const provider: KekProvider = { getKek: () => Buffer.from(KEY_B64, "base64") };

  describe("encrypt() / decrypt() round-trip", () => {
    it("decrypts to the original plaintext", () => {
      const svc = new FieldEncryptionService(provider);
      const ct = svc.encrypt("hello world");
      const pt = svc.decrypt(ct);
      expect(pt).toBe("hello world");
    });

    it("handles empty strings", () => {
      const svc = new FieldEncryptionService(provider);
      expect(svc.decrypt(svc.encrypt(""))).toBe("");
    });

    it("handles unicode (emoji, multi-byte chars)", () => {
      const svc = new FieldEncryptionService(provider);
      expect(svc.decrypt(svc.encrypt("🦄 ünïçødé"))).toBe("🦄 ünïçødé");
    });

    it("emits a different ciphertext each call (random IV)", () => {
      const svc = new FieldEncryptionService(provider);
      const a = svc.encrypt("same plaintext");
      const b = svc.encrypt("same plaintext");
      expect(a).not.toBe(b);
    });

    it("ciphertext is base64url-safe and prefixed with the version tag `v1:`", () => {
      const svc = new FieldEncryptionService(provider);
      const ct = svc.encrypt("hello");
      expect(ct.startsWith("v1:")).toBe(true);
      expect(ct.slice(3)).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe("tamper-detection", () => {
    it("decrypt() throws when the ciphertext is tampered with (auth-tag mismatch)", () => {
      const svc = new FieldEncryptionService(provider);
      const ct = svc.encrypt("hello");
      const tampered = `v1:${ct.slice(3, -2)}AA`;
      expect(() => svc.decrypt(tampered)).toThrow();
    });

    it("decrypt() throws on an unknown version prefix", () => {
      const svc = new FieldEncryptionService(provider);
      expect(() => svc.decrypt("v9:abcd")).toThrow(/version/i);
    });

    it("decrypt() throws on a wholly malformed input", () => {
      const svc = new FieldEncryptionService(provider);
      expect(() => svc.decrypt("not-encrypted")).toThrow();
    });
  });

  describe("KEK rotation", () => {
    it("decrypts with a different KEK fails (wrong key)", () => {
      const a = new FieldEncryptionService({ getKek: () => Buffer.alloc(32, 0x01) });
      const b = new FieldEncryptionService({ getKek: () => Buffer.alloc(32, 0x02) });
      const ct = a.encrypt("secret");
      expect(() => b.decrypt(ct)).toThrow();
    });

    it("rejects KEKs that are not exactly 32 bytes", () => {
      expect(() =>
        new FieldEncryptionService({ getKek: () => Buffer.alloc(31) }).encrypt("x"),
      ).toThrow(/32/);
      expect(() =>
        new FieldEncryptionService({ getKek: () => Buffer.alloc(33) }).encrypt("x"),
      ).toThrow(/32/);
    });
  });

  describe("EnvKekProvider", () => {
    it("reads the base64 KEK from FIELD_ENCRYPTION_KEK", () => {
      const env = new EnvKekProvider({ FIELD_ENCRYPTION_KEK: KEY_B64 });
      const kek = env.getKek();
      expect(kek.length).toBe(32);
      expect(kek.equals(Buffer.from(KEY_B64, "base64"))).toBe(true);
    });

    it("throws when the env var is missing", () => {
      expect(() => new EnvKekProvider({}).getKek()).toThrow(/FIELD_ENCRYPTION_KEK/);
    });

    it("throws when the decoded KEK is not 32 bytes", () => {
      const tooShort = Buffer.alloc(16, 1).toString("base64");
      expect(() => new EnvKekProvider({ FIELD_ENCRYPTION_KEK: tooShort }).getKek()).toThrow(/32/);
    });
  });
});
