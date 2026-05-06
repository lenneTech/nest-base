import { randomBytes } from "node:crypto";

import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { BLIND_INDEX, BlindIndex, EncryptionModule } from "../../src/core/encryption/index.js";

/**
 * Story · EncryptionModule binds BlindIndex when BLIND_INDEX_KEY is set.
 *
 * The PRD pins "AES-256-GCM field encryption + KEK rotation + blind
 * index for searchable encrypted fields". This story closes the loop
 * — once a project supplies `BLIND_INDEX_KEY`, the
 * `BLIND_INDEX` DI token resolves to a `BlindIndex` instance any
 * service can inject.
 *
 * Half-set crypto config (KEK present + blind-index-key malformed) is
 * a deployment mistake — the module throws at boot rather than
 * silently shipping a broken lookup column.
 */
const HEX_KEY = randomBytes(32).toString("hex");
const KEK_BASE64 = randomBytes(32).toString("base64");

describe("Story · EncryptionModule + BlindIndex wiring", () => {
  it("registers a BlindIndex provider when BLIND_INDEX_KEY is supplied (hex)", async () => {
    const module = await Test.createTestingModule({
      imports: [
        EncryptionModule.forRoot({
          env: { FIELD_ENCRYPTION_KEK: KEK_BASE64, BLIND_INDEX_KEY: HEX_KEY },
        }),
      ],
    }).compile();
    const idx = module.get<BlindIndex>(BLIND_INDEX);
    expect(idx).toBeInstanceOf(BlindIndex);
    expect(idx.compute("alice@example.com")).not.toBeNull();
    await module.close();
  });

  it("registers a BlindIndex provider when BLIND_INDEX_KEY is supplied (base64)", async () => {
    const b64 = randomBytes(32).toString("base64");
    const module = await Test.createTestingModule({
      imports: [
        EncryptionModule.forRoot({
          env: { FIELD_ENCRYPTION_KEK: KEK_BASE64, BLIND_INDEX_KEY: b64 },
        }),
      ],
    }).compile();
    const idx = module.get<BlindIndex>(BLIND_INDEX);
    expect(idx).toBeInstanceOf(BlindIndex);
    await module.close();
  });

  it("omits the BlindIndex provider when BLIND_INDEX_KEY is unset", async () => {
    const module = await Test.createTestingModule({
      imports: [EncryptionModule.forRoot({ env: { FIELD_ENCRYPTION_KEK: KEK_BASE64 } })],
    }).compile();
    expect(() => module.get<BlindIndex>(BLIND_INDEX)).toThrow();
    await module.close();
  });

  it("throws at module-build time when BLIND_INDEX_KEY is malformed (too short)", async () => {
    const tooShort = randomBytes(8).toString("hex"); // 8 bytes — too short
    expect(() => {
      EncryptionModule.forRoot({
        env: { FIELD_ENCRYPTION_KEK: KEK_BASE64, BLIND_INDEX_KEY: tooShort },
      });
    }).toThrow(/BLIND_INDEX_KEY/);
  });

  it("uses an explicit BlindIndex override when caller supplies one", async () => {
    const override = new BlindIndex({ key: randomBytes(32), truncateChars: 16 });
    const module = await Test.createTestingModule({
      imports: [
        EncryptionModule.forRoot({
          env: { FIELD_ENCRYPTION_KEK: KEK_BASE64 }, // no BLIND_INDEX_KEY
          blindIndex: override,
        }),
      ],
    }).compile();
    const idx = module.get<BlindIndex>(BLIND_INDEX);
    expect(idx).toBe(override);
    expect(idx.compute("alice@example.com")).toHaveLength(16);
    await module.close();
  });
});
