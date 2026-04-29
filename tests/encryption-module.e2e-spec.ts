import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { EncryptionModule } from "../src/core/encryption/encryption.module.js";
import { FieldEncryptionService } from "../src/core/encryption/index.js";

/**
 * EncryptionModule provides a working FieldEncryptionService through DI.
 * Wired here so consumers can `@Inject(FieldEncryptionService)` in any
 * module that opts into `features.fieldEncryption.enabled`.
 */
describe("EncryptionModule · DI wiring", () => {
  // 32 random bytes, base64-encoded (= 44 chars with `=` padding).
  const KEK = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  it("provides FieldEncryptionService when KEK is configured", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EncryptionModule.forRoot({ env: { FIELD_ENCRYPTION_KEK: KEK } })],
    }).compile();

    const svc = moduleRef.get(FieldEncryptionService);
    expect(svc).toBeInstanceOf(FieldEncryptionService);

    const ct = svc.encrypt("hello");
    expect(ct).toMatch(/^v1:/);
    expect(svc.decrypt(ct)).toBe("hello");
  });

  it("throws on first decrypt() call when KEK is missing (lazy validation)", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EncryptionModule.forRoot({ env: {} })],
    }).compile();

    const svc = moduleRef.get(FieldEncryptionService);
    expect(() => svc.encrypt("hello")).toThrow(/FIELD_ENCRYPTION_KEK/);
  });
});
