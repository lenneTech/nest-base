import type { BlindIndex } from "../encryption/blind-index.js";
import type { PrismaService } from "../prisma/prisma.service.js";

export interface UserBlindIndexRow {
  readonly id: string;
  readonly email: string;
}

/**
 * Find a User row by email via the blind-index companion column
 * (CF.SEC.03). The lookup hashes the supplied email through the
 * `BlindIndex` provider (case-folded + trimmed) and queries
 * `users.email_hash` — the unique index makes the lookup O(1).
 *
 * Why this and not `prisma.user.findUnique({ where: { email } })`:
 * once `email` is AES-256-GCM encrypted at rest, the ciphertext is
 * non-deterministic so equality lookups against the encrypted column
 * fail. The blind index sidesteps that — equality + uniqueness
 * survive encryption.
 *
 * Returns `null` when no match. Empty / whitespace email returns
 * null without touching the database (the `BlindIndex.compute()`
 * planner returns null for empty inputs and the SQL filter would
 * match nothing anyway).
 */
export async function findUserByEmail(
  prisma: PrismaService,
  blindIndex: BlindIndex,
  email: string,
): Promise<UserBlindIndexRow | null> {
  const hash = blindIndex.compute(email);
  if (hash === null) return null;
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, email FROM users WHERE email_hash = $1 LIMIT 1`,
    hash,
  )) as Array<{ id: string; email: string }>;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
  };
}
