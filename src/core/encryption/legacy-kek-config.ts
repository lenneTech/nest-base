/**
 * Pure planner — parse the `FIELD_ENCRYPTION_LEGACY_KEKS` env-var
 * (CF.SEC.02 / SC.SUB.12 — iter-188) into the array of legacy KEK
 * buffers the `MultiKekFieldEncryption` consumes.
 *
 * Format: comma-separated base64-encoded 32-byte AES-256 keys.
 * Whitespace is trimmed, empty entries are dropped (defensive against
 * stray commas), malformed entries throw — KEK rotation is a
 * security boundary, fail-fast is the right default.
 *
 * Order is preserved: operators stage rotation by listing the
 * most-recent legacy KEK first (the highest-hit-rate slot during
 * ciphertext migration).
 *
 * Examples:
 *   ""                      → []
 *   "AAAA…AAA="             → [Buffer<32>]
 *   "AAAA…AAA=, BBBB…BBB="  → [Buffer<32>, Buffer<32>]
 */

const KEK_BYTES = 32; // AES-256

export function parseLegacyKeks(input: string | undefined): Buffer[] {
  if (!input) return [];
  const out: Buffer[] = [];
  for (const raw of input.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length !== KEK_BYTES) {
      throw new Error(
        `FIELD_ENCRYPTION_LEGACY_KEKS entries must decode to ${KEK_BYTES} bytes (received ${buf.length} for "${trimmed.slice(0, 8)}…")`,
      );
    }
    out.push(buf);
  }
  return out;
}
