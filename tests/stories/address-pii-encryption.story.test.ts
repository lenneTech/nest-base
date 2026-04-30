import { describe, expect, it } from "vitest";

import { FieldEncryptionService } from "../../src/core/encryption/field-encryption.service.js";
import {
  ADDRESS_ENCRYPTED_FIELDS,
  decryptAddress,
  encryptAddress,
} from "../../src/core/geo/address-pii-encryption.js";

/**
 * Story · Address PII encryption.
 *
 * Address PII (`street`, `zip`) gets app-layer field-encryption at
 * write time + decryption at read time. The audit-log builder
 * already replaces these with `[encrypted]`; the geo helpers here
 * make sure the persistence layer round-trips them through the
 * existing FieldEncryptionService.
 */
describe("Story · Address PII encryption", () => {
  function service(): FieldEncryptionService {
    const key = Buffer.alloc(32);
    Buffer.from("AddressPiiTestKEK_____AddressPii").copy(key);
    return new FieldEncryptionService({ getKek: () => key });
  }

  it("declares street + zip as the PII fields covered", () => {
    expect(ADDRESS_ENCRYPTED_FIELDS).toEqual(["street", "zip"]);
  });

  describe("encryptAddress()", () => {
    it("encrypts street + zip, leaves city/country/state in cleartext", () => {
      const svc = service();
      const out = encryptAddress(svc, {
        street: "Hauptstraße 1",
        zip: "10115",
        city: "Berlin",
        country: "DE",
        state: "Berlin",
      });
      expect(out.street).not.toBe("Hauptstraße 1");
      expect(out.street.startsWith("v1:")).toBe(true);
      expect(out.zip).not.toBe("10115");
      expect(out.zip.startsWith("v1:")).toBe(true);
      expect(out.city).toBe("Berlin");
      expect(out.country).toBe("DE");
      expect(out.state).toBe("Berlin");
    });

    it("produces different ciphertexts for the same plaintext (random IV per call)", () => {
      const svc = service();
      const a = encryptAddress(svc, { street: "x", zip: "y", city: "c", country: "DE" });
      const b = encryptAddress(svc, { street: "x", zip: "y", city: "c", country: "DE" });
      expect(a.street).not.toBe(b.street);
      expect(a.zip).not.toBe(b.zip);
    });

    it("passes through non-PII fields verbatim (metadata + state etc.)", () => {
      const svc = service();
      const out = encryptAddress(svc, {
        street: "x",
        zip: "y",
        city: "c",
        country: "DE",
        formattedAddress: "whatever",
      } as never);
      expect((out as Record<string, unknown>).formattedAddress).toBe("whatever");
    });
  });

  describe("decryptAddress()", () => {
    it("round-trips encrypted → decrypted", () => {
      const svc = service();
      const enc = encryptAddress(svc, {
        street: "Hauptstraße 1",
        zip: "10115",
        city: "Berlin",
        country: "DE",
      });
      const dec = decryptAddress(svc, enc);
      expect(dec.street).toBe("Hauptstraße 1");
      expect(dec.zip).toBe("10115");
      expect(dec.city).toBe("Berlin");
    });

    it("throws when the ciphertext is tampered (GCM auth-tag mismatch)", () => {
      const svc = service();
      const enc = encryptAddress(svc, {
        street: "Hauptstraße 1",
        zip: "10115",
        city: "Berlin",
        country: "DE",
      });
      const tampered = { ...enc, street: enc.street.slice(0, -2) + "XX" };
      expect(() => decryptAddress(svc, tampered)).toThrow();
    });

    it("handles empty-string PII (encrypted empty round-trips empty)", () => {
      const svc = service();
      const enc = encryptAddress(svc, { street: "", zip: "", city: "Berlin", country: "DE" });
      const dec = decryptAddress(svc, enc);
      expect(dec.street).toBe("");
      expect(dec.zip).toBe("");
    });
  });
});
