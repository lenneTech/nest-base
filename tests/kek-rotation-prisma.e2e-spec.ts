import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EnvKekProvider } from "../src/core/encryption/kek-provider.js";
import { FieldEncryptionService } from "../src/core/encryption/field-encryption.service.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";
import { uuidV7 } from "../src/core/uuid/uuid-v7.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

// Two distinct 32-byte AES-256 KEKs, base64-encoded. Both decode to
// 32 bytes; the only differences are the underlying byte patterns
// (KEK_OLD is all 0xAA, KEK_NEW is all 0xBB) so a decrypt path that
// tries the wrong KEK reliably fails the GCM auth-tag check.
const KEK_OLD = "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=";
const KEK_NEW = "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s=";

/**
 * E2E · KEK rotation through the production Prisma extension chain
 * (SC.SUB.12 closure — iter-188).
 *
 * Iter-187 closed SC.SUB.11 (raw row → no plaintext). The remaining
 * SC.SUB.12 PRD pin: "decrypt rows encrypted under a prior KEK after
 * staging the new KEK in the primary slot." Iter-188 wires the
 * production extension chain to `MultiKekFieldEncryption` (`prisma.
 * service.ts:319-336`) so `FIELD_ENCRYPTION_LEGACY_KEKS` activates
 * the legacy-fallback decrypt path. This e2e proves the rotation
 * round-trip works at the storage boundary, not just in the in-
 * memory service.
 *
 * Test sequence:
 *   1. Encrypt a row's `description` under KEK_OLD (using the
 *      `FieldEncryptionService` directly so we can pin the ciphertext
 *      to a specific KEK without spinning two app instances).
 *   2. Insert the row via raw SQL (bypasses the extension chain).
 *   3. Boot the app with KEK_NEW as primary + KEK_OLD as legacy.
 *   4. Read the row via `prisma.client.role.findFirst` — the
 *      production extension chain's decrypt path tries KEK_NEW
 *      first (auth-tag mismatch), falls through to KEK_OLD, decrypts
 *      successfully, returns the plaintext.
 *   5. Encrypt a NEW value through `prisma.client.role.update` —
 *      the extension's encrypt path uses KEK_NEW only.
 *   6. Read the raw column — the new ciphertext decrypts ONLY under
 *      KEK_NEW, NOT under KEK_OLD (proves the encrypt direction is
 *      single-KEK; rotation is a read-side fallback).
 */
describe("E2E · KEK rotation through Prisma field-encryption extension (SC.SUB.12)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let roleId: string;
  const PLAINTEXT_OLD = `legacy-${crypto.randomUUID()}`;
  const originalEnv: Record<string, string | undefined> = {};

  function rememberEnv(key: string): void {
    originalEnv[key] = process.env[key];
  }

  beforeAll(async () => {
    rememberEnv("FEATURE_FIELD_ENCRYPTION");
    rememberEnv("FIELD_ENCRYPTION_KEK");
    rememberEnv("FIELD_ENCRYPTION_LEGACY_KEKS");
    rememberEnv("FIELD_ENCRYPTION_MODEL_FIELDS");
    rememberEnv("BETTER_AUTH_SECRET");
    rememberEnv("APP_BASE_URL");

    process.env.FEATURE_FIELD_ENCRYPTION = "true";
    // Stage rotation: KEK_NEW is primary; KEK_OLD is legacy.
    process.env.FIELD_ENCRYPTION_KEK = KEK_NEW;
    process.env.FIELD_ENCRYPTION_LEGACY_KEKS = KEK_OLD;
    process.env.FIELD_ENCRYPTION_MODEL_FIELDS = "Role.description";
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-minimum-aaaaaaaa";
    process.env.APP_BASE_URL = "http://localhost:3000";

    const { bootstrap } = await import("../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    const orgName = `kek-rotation-e2e-${crypto.randomUUID()}`;
    const tenant = await prisma.organization.create({
      data: {
        id: uuidV7(),
        name: orgName,
        slug:
          orgName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 50) +
          "-" +
          Date.now(),
        createdAt: new Date(),
      },
    });
    tenantId = tenant.id;
    roleId = crypto.randomUUID();

    // Pre-encrypt the description under KEK_OLD using the direct
    // service path. The resulting ciphertext is what a row written
    // before the rotation would carry on disk.
    const oldFes = new FieldEncryptionService(
      new EnvKekProvider({ FIELD_ENCRYPTION_KEK: KEK_OLD }),
    );
    const ciphertextOld = oldFes.encrypt(PLAINTEXT_OLD);
    expect(ciphertextOld).toMatch(/^v1:/);

    // Insert via raw SQL — bypasses the extension chain so the
    // ciphertext lands on disk verbatim, untouched by KEK_NEW.
    await prisma.$executeRawUnsafe(
      `INSERT INTO roles (id, name, description, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      roleId,
      `kek-rotation-${crypto.randomUUID()}`,
      ciphertextOld,
      tenantId,
    );
  });

  afterAll(async () => {
    try {
      await prisma.role.deleteMany({ where: { tenantId } });
      await prisma.organization.delete({ where: { id: tenantId } });
    } catch {
      /* best-effort cleanup */
    }
    await app.close();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("a row encrypted under the LEGACY KEK still decrypts via the production extension chain after rotation", async () => {
    // The extension chain tries KEK_NEW first (auth-tag mismatch),
    // then walks the legacy list and finds KEK_OLD which succeeds.
    // This is the load-bearing rotation contract: existing rows
    // decrypt without a re-encryption pass.
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT description FROM roles WHERE id = $1`,
      roleId,
    )) as Array<{ description: string }>;
    const ciphertextOnDisk = rows[0]?.description ?? "";
    expect(ciphertextOnDisk).toMatch(/^v1:/);

    // The on-disk ciphertext does NOT decrypt with KEK_NEW alone —
    // proves the legacy fallback is what's making the round-trip work.
    const newOnlyFes = new FieldEncryptionService(
      new EnvKekProvider({ FIELD_ENCRYPTION_KEK: KEK_NEW }),
    );
    expect(() => newOnlyFes.decrypt(ciphertextOnDisk)).toThrow();

    // The on-disk ciphertext DOES decrypt with KEK_OLD alone —
    // proves the row was genuinely encrypted under the legacy KEK.
    const oldOnlyFes = new FieldEncryptionService(
      new EnvKekProvider({ FIELD_ENCRYPTION_KEK: KEK_OLD }),
    );
    expect(oldOnlyFes.decrypt(ciphertextOnDisk)).toBe(PLAINTEXT_OLD);
  });

  it("a re-encryption (UPDATE) through the extended client lands a ciphertext readable ONLY under KEK_NEW", async () => {
    const PLAINTEXT_NEW = `rotated-${crypto.randomUUID()}`;
    await prisma.client.role.update({
      where: { id: roleId },
      data: { description: PLAINTEXT_NEW },
    });

    const rows = (await prisma.$queryRawUnsafe(
      `SELECT description FROM roles WHERE id = $1`,
      roleId,
    )) as Array<{ description: string }>;
    const ciphertextOnDisk = rows[0]?.description ?? "";
    expect(ciphertextOnDisk).toMatch(/^v1:/);

    // KEK_NEW decrypts the new ciphertext.
    const newOnlyFes = new FieldEncryptionService(
      new EnvKekProvider({ FIELD_ENCRYPTION_KEK: KEK_NEW }),
    );
    expect(newOnlyFes.decrypt(ciphertextOnDisk)).toBe(PLAINTEXT_NEW);

    // KEK_OLD does NOT — proves the encrypt path uses ONLY the
    // primary KEK; the legacy slot is read-only fallback.
    const oldOnlyFes = new FieldEncryptionService(
      new EnvKekProvider({ FIELD_ENCRYPTION_KEK: KEK_OLD }),
    );
    expect(() => oldOnlyFes.decrypt(ciphertextOnDisk)).toThrow();
  });

  it("a fresh CREATE under the rotated KEK_NEW lands a ciphertext readable only via KEK_NEW", async () => {
    const PLAINTEXT_FRESH = `fresh-${crypto.randomUUID()}`;
    const role = await prisma.client.role.create({
      data: {
        name: `fresh-create-${crypto.randomUUID()}`,
        tenantId,
        description: PLAINTEXT_FRESH,
      },
    });

    const rows = (await prisma.$queryRawUnsafe(
      `SELECT description FROM roles WHERE id = $1`,
      role.id,
    )) as Array<{ description: string }>;
    const ciphertextOnDisk = rows[0]?.description ?? "";

    const newOnlyFes = new FieldEncryptionService(
      new EnvKekProvider({ FIELD_ENCRYPTION_KEK: KEK_NEW }),
    );
    expect(newOnlyFes.decrypt(ciphertextOnDisk)).toBe(PLAINTEXT_FRESH);

    const oldOnlyFes = new FieldEncryptionService(
      new EnvKekProvider({ FIELD_ENCRYPTION_KEK: KEK_OLD }),
    );
    expect(() => oldOnlyFes.decrypt(ciphertextOnDisk)).toThrow();
  });
});
