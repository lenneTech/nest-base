#!/usr/bin/env bun
/**
 * `bun run hub:reset-password` — generate a fresh Hub password and store
 * its argon2 hash in `system_secrets`. The new plaintext is printed ONCE
 * and never stored — store it before the process exits.
 *
 * This script talks to Postgres directly via Prisma without booting the
 * full NestJS application, so it is safe to run while the server is live.
 *
 * Refuses if DATABASE_URL is not set.
 */

import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  process.stderr.write("[hub:reset-password] DATABASE_URL is not set\n");
  process.exit(1);
}

// Key must match HUB_PASSWORD_SECRET_KEY in hub-password.service.ts.
const HUB_PASSWORD_SECRET_KEY = "hub_password_hash";

/** Generate a 24-character base32 password (RFC 4648: A–Z + 2–7). */
function generateBase32Password(length: 24): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]!).join("");
}

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

try {
  const plaintext = generateBase32Password(24);
  const hashed = await hash(plaintext);

  await prisma.systemSecret.upsert({
    where: { key: HUB_PASSWORD_SECRET_KEY },
    update: { value: hashed },
    create: { key: HUB_PASSWORD_SECRET_KEY, value: hashed },
  });

  process.stdout.write(`
╔══════════════════════════════════════════════════════════════════╗
║                    HUB PASSWORD RESET                            ║
║                                                                  ║
║  STORE THIS NOW — it will never be shown again.                  ║
║                                                                  ║
║  Password: ${plaintext.padEnd(53)}║
║                                                                  ║
║  Use it to log in to the Hub UI at /                             ║
╚══════════════════════════════════════════════════════════════════╝
`);
} finally {
  await prisma.$disconnect();
}
