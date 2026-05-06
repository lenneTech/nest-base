import { randomBytes } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BLIND_INDEX, BlindIndex } from "../../src/core/encryption/index.js";
import { PrismaService } from "../../src/core/prisma/prisma.service.js";
import { findUserByEmail } from "../../src/core/auth/user-blind-index.lookup.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Story · BlindIndex consumer model — User.emailHash auto-populated +
 * lookup-by-email via the blind index (CF.SEC.03 — Finding 7).
 *
 * Iter-84 added the `BlindIndex` class + `EncryptionModule` provider
 * but no model consumed it — the iter-84 reviewer flagged "BlindIndex
 * is registered… but no model/field consumes it. Status: partial".
 *
 * Iter-94 closes the loop by:
 *  1. Adding `email_hash` column to `users` table (companion to the
 *     unique `email` column).
 *  2. Auto-populating `email_hash` on every User create/update via the
 *     `userEmailBlindIndexExtension` Prisma extension bound in
 *     `PrismaService.client`.
 *  3. Exposing `findUserByEmail(prisma, blindIndex, email)` so
 *     equality lookups go through the deterministic HMAC index — the
 *     real searchable-encrypted-field use case.
 *
 * This test boots the full app with `BLIND_INDEX_KEY` set, creates a
 * user via the extended client, asserts `email_hash` is populated to
 * the expected HMAC, then resolves the user by email via the lookup
 * helper.
 */
describe("Story · User.emailHash auto-populated by BlindIndex extension", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let blindIndex: BlindIndex;

  // Stable test key so the planner accepts it.
  const TEST_KEY_HEX = randomBytes(32).toString("hex");

  beforeAll(async () => {
    process.env.BLIND_INDEX_KEY = TEST_KEY_HEX;
    process.env.FEATURE_FIELD_ENCRYPTION_ENABLED = "true";
    process.env.FIELD_ENCRYPTION_KEK = randomBytes(32).toString("base64");
    const { bootstrap } = await import("../../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
    blindIndex = app.get<BlindIndex>(BLIND_INDEX);

    // After issue #118, the old `tenants` table was dropped and User.tenantId was
    // removed. User records are created without a tenant FK — no parent row needed.
  });

  afterAll(async () => {
    if (prisma) {
      // Clean up test users by email pattern — User.tenantId was removed in
      // issue #118, so we can no longer scope cleanup by tenantId.
      await prisma.$executeRawUnsafe(
        `DELETE FROM users WHERE email LIKE 'iter94-%@example.com' OR email LIKE '%iter94-%@example.com'`,
      );
    }
    if (app) await app.close();
    delete process.env.BLIND_INDEX_KEY;
    delete process.env.FEATURE_FIELD_ENCRYPTION_ENABLED;
    delete process.env.FIELD_ENCRYPTION_KEK;
  });

  it("create() through prisma.client.user populates email_hash with the deterministic HMAC", async () => {
    const email = `iter94-create-${Date.now()}@example.com`;
    // User.tenantId was removed in issue #118 — no tenantId field on User.
    const created = await prisma.client.user.create({
      data: {
        email,
        name: "Iter 94 Create",
      },
    });

    // Read back the row (the create extension may NOT round-trip the
    // emailHash field via the model delegate, so query SQL directly).
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT email, email_hash FROM users WHERE id = $1::uuid`,
      created.id,
    )) as Array<{ email: string; email_hash: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe(email);
    expect(rows[0]?.email_hash).toBe(blindIndex.compute(email));
  });

  it("update() to a new email re-computes email_hash to match the new value", async () => {
    const email = `iter94-update-${Date.now()}@example.com`;
    const newEmail = `iter94-update-renamed-${Date.now()}@example.com`;
    const created = await prisma.client.user.create({
      data: { email, name: "Iter 94 Update" },
    });

    await prisma.client.user.update({
      where: { id: created.id },
      data: { email: newEmail },
    });

    const rows = (await prisma.$queryRawUnsafe(
      `SELECT email_hash FROM users WHERE id = $1::uuid`,
      created.id,
    )) as Array<{ email_hash: string | null }>;
    expect(rows[0]?.email_hash).toBe(blindIndex.compute(newEmail));
  });

  it("normalisation: case-folded email lookup finds the user via blind-index hash", async () => {
    const email = `Iter94-CaseFold-${Date.now()}@Example.com`;
    const created = await prisma.client.user.create({
      data: { email, name: "Iter 94 Case Fold" },
    });

    // Look up with a different case — the blind index normalises before HMAC.
    const found = await findUserByEmail(prisma, blindIndex, email.toUpperCase());
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);

    // Lookup with a different (non-matching) email returns null.
    const missing = await findUserByEmail(prisma, blindIndex, "nobody@example.com");
    expect(missing).toBeNull();
  });
});
