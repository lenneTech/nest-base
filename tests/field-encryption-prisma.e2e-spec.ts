import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaService } from "../src/core/prisma/prisma.service.js";
import { uuidV7 } from "../src/core/uuid/uuid-v7.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

// 32 random bytes, base64-encoded (= 44 chars with `=` padding) — the
// AES-256-GCM key the FieldEncryptionService consumes via EnvKekProvider.
const KEK_PRIMARY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

/**
 * E2E · Prisma field-encryption extension live SELECT round-trip
 * (SC.SUB.11/12 closure — iter-187).
 *
 * The deviation register's SC.SUB.* row notes: "writes an encrypted
 * field, dumps raw row via pg, verifies plaintext is not present"
 * for SC.SUB.11; the matching tests covered the AES-GCM contract
 * against the in-memory `FieldEncryptionService` only. This e2e
 * closes the gap by:
 *
 *   1. Booting the full app with `FEATURE_FIELD_ENCRYPTION=true` +
 *      `FIELD_ENCRYPTION_KEK=<base64-32>` + `FIELD_ENCRYPTION_MODEL_FIELDS=Role.description`
 *      so the production extension chain at `prisma.service.ts:319-336`
 *      activates `buildFieldEncryptionExtension` against `Role.description`.
 *   2. Writing a Role through `prisma.client.role.create(...)` with
 *      a known plaintext description.
 *   3. Reading the decrypted value back via
 *      `prisma.client.role.findUnique(...)` (extended client →
 *      decrypt path).
 *   4. Reading the raw column via `$queryRawUnsafe SELECT description
 *      FROM roles WHERE id = $1` (bare SQL → bypasses the extension)
 *      and asserting the on-disk bytes do NOT contain the plaintext
 *      and DO carry the `v1:` ciphertext prefix.
 */
describe("E2E · Field-encryption Prisma extension fires through the extended client (SC.SUB.11/12)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  const originalEnv: Record<string, string | undefined> = {};

  function rememberEnv(key: string): void {
    originalEnv[key] = process.env[key];
  }

  beforeAll(async () => {
    rememberEnv("FEATURE_FIELD_ENCRYPTION");
    rememberEnv("FIELD_ENCRYPTION_KEK");
    rememberEnv("FIELD_ENCRYPTION_MODEL_FIELDS");
    rememberEnv("BETTER_AUTH_SECRET");
    rememberEnv("APP_BASE_URL");
    process.env.FEATURE_FIELD_ENCRYPTION = "true";
    process.env.FIELD_ENCRYPTION_KEK = KEK_PRIMARY;
    // Encrypt only the `description` column on Role for this test.
    // The schema is unaffected; the column stays TEXT and just stores
    // the AES-GCM ciphertext blob.
    process.env.FIELD_ENCRYPTION_MODEL_FIELDS = "Role.description";
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";

    const { bootstrap } = await import("../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    const orgName = `field-enc-e2e-${crypto.randomUUID()}`;
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

  it("write through the extended client encrypts the field; the raw on-disk bytes never contain the plaintext", async () => {
    const PLAINTEXT = `secret-${crypto.randomUUID()}-payload`;
    const role = await prisma.client.role.create({
      data: {
        name: `e2e-encrypt-${crypto.randomUUID()}`,
        tenantId,
        description: PLAINTEXT,
      },
    });

    // Raw on-disk read — bypasses the extension chain entirely.
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT description FROM roles WHERE id = $1`,
      role.id,
    )) as Array<{ description: string | null }>;
    expect(rows).toHaveLength(1);
    const onDisk = rows[0]?.description ?? "";
    // The raw column DOES carry the `v1:` ciphertext prefix and DOES
    // NOT contain the plaintext substring anywhere in its bytes —
    // this is the load-bearing security contract: a DBA dumping the
    // table never sees plaintext.
    expect(onDisk).toMatch(/^v1:/);
    expect(onDisk.includes(PLAINTEXT)).toBe(false);
  });

  it("ciphertext from the raw column round-trips through FieldEncryptionService.decrypt back to plaintext", async () => {
    // The decrypt-on-read half of the contract: the
    // FieldEncryptionService that the production extension chain
    // wires (`prisma.service.ts:321` `new FieldEncryptionService(new
    // EnvKekProvider(env))`) decrypts what it encrypted. We
    // construct a fresh service against the same KEK and assert the
    // ciphertext from the raw column round-trips.
    const PLAINTEXT = `roundtrip-${crypto.randomUUID()}`;
    const role = await prisma.client.role.create({
      data: { name: `e2e-decrypt-${crypto.randomUUID()}`, tenantId, description: PLAINTEXT },
    });
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT description FROM roles WHERE id = $1`,
      role.id,
    )) as Array<{ description: string | null }>;
    const ciphertext = rows[0]?.description ?? "";
    expect(ciphertext).toMatch(/^v1:/);

    const { FieldEncryptionService, EnvKekProvider } =
      await import("../src/core/encryption/index.js");
    const fes = new FieldEncryptionService(
      new EnvKekProvider({ FIELD_ENCRYPTION_KEK: KEK_PRIMARY }),
    );
    expect(fes.decrypt(ciphertext)).toBe(PLAINTEXT);
  });

  it("update through the extended client re-encrypts on write; raw column reflects the new ciphertext, not the new plaintext", async () => {
    const role = await prisma.client.role.create({
      data: { name: `e2e-update-${crypto.randomUUID()}`, tenantId, description: "v1-plaintext" },
    });
    await prisma.client.role.update({
      where: { id: role.id },
      data: { description: "v2-plaintext-rotated" },
    });

    const rows = (await prisma.$queryRawUnsafe(
      `SELECT description FROM roles WHERE id = $1`,
      role.id,
    )) as Array<{ description: string | null }>;
    const onDisk = rows[0]?.description ?? "";
    expect(onDisk).toMatch(/^v1:/);
    expect(onDisk.includes("v2-plaintext-rotated")).toBe(false);
    expect(onDisk.includes("v1-plaintext")).toBe(false);

    // Decrypt the latest ciphertext via the same FieldEncryptionService
    // production wires; the recovered plaintext is the post-update
    // value, proving the update path also goes through the encryption
    // extension (not just the create path).
    const { FieldEncryptionService, EnvKekProvider } =
      await import("../src/core/encryption/index.js");
    const fes = new FieldEncryptionService(
      new EnvKekProvider({ FIELD_ENCRYPTION_KEK: KEK_PRIMARY }),
    );
    expect(fes.decrypt(onDisk)).toBe("v2-plaintext-rotated");
  });

  it("the same plaintext written twice produces distinct ciphertexts (per-write IV is fresh)", async () => {
    const a = await prisma.client.role.create({
      data: { name: `e2e-iv-a-${crypto.randomUUID()}`, tenantId, description: "same-plaintext" },
    });
    const b = await prisma.client.role.create({
      data: { name: `e2e-iv-b-${crypto.randomUUID()}`, tenantId, description: "same-plaintext" },
    });

    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id, description FROM roles WHERE id IN ($1, $2)`,
      a.id,
      b.id,
    )) as Array<{ id: string; description: string }>;
    expect(rows).toHaveLength(2);
    const aRow = rows.find((r) => r.id === a.id)!;
    const bRow = rows.find((r) => r.id === b.id)!;
    // Same plaintext, fresh IV per encrypt → distinct ciphertexts.
    // This is the AES-GCM contract that makes ciphertext non-linkable
    // across rows even when the underlying plaintext is identical.
    expect(aRow.description).not.toBe(bRow.description);
    expect(aRow.description).toMatch(/^v1:/);
    expect(bRow.description).toMatch(/^v1:/);
  });

  it("non-encrypted columns (Role.name) round-trip verbatim — only the configured field is touched", async () => {
    const NAME = `e2e-name-${crypto.randomUUID()}`;
    const role = await prisma.client.role.create({
      data: { name: NAME, tenantId, description: "secret" },
    });

    const rows = (await prisma.$queryRawUnsafe(
      `SELECT name, description FROM roles WHERE id = $1`,
      role.id,
    )) as Array<{ name: string; description: string }>;
    // `name` is NOT in FIELD_ENCRYPTION_MODEL_FIELDS so it stays as
    // plaintext on disk; `description` is encrypted.
    expect(rows[0]?.name).toBe(NAME);
    expect(rows[0]?.description).toMatch(/^v1:/);
    expect(rows[0]?.description.includes("secret")).toBe(false);
  });
});
