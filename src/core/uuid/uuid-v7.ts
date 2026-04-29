import { randomFillSync } from "node:crypto";

/**
 * UUID v7 (RFC 9562) — time-ordered identifier.
 *
 * Layout:
 *   - bytes 0-5  : 48-bit unix-millis timestamp
 *   - byte 6     : version=7 (high nibble) + 4 random bits
 *   - byte 7     : 8 random bits
 *   - byte 8     : variant=10xx + 6 random bits
 *   - bytes 9-15 : 56 random bits
 *
 * The DB writes the same shape via the `pg_uuidv7` Postgres extension —
 * this Node-side generator covers logs / request-ids / test fixtures
 * where the DB is not in scope. See `prisma/migrations/.../migration.sql`
 * for the extension installer.
 */
export function uuidV7(): string {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);

  const ms = BigInt(Date.now());
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex: string[] = [];
  for (const b of bytes) hex.push(b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV7(value: string): boolean {
  return UUID_V7_RE.test(value);
}
