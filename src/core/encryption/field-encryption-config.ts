/**
 * Pure planner — parse the `FIELD_ENCRYPTION_MODEL_FIELDS` env-var
 * into the `Record<string, readonly string[]>` shape that
 * `buildFieldEncryptionExtension` expects.
 *
 * Format: comma-separated `Model.field` pairs. Whitespace is trimmed.
 * Empty pairs / pairs without a dot are silently dropped (defensive
 * — an operator who copy-pastes a stray comma shouldn't take down
 * the boot path).
 *
 * Examples:
 *   ""                                     → {}
 *   "User.profile_note"                    → { User: ["profile_note"] }
 *   "User.note, User.address, Tenant.api_key"
 *                                          → { User: ["note","address"], Tenant: ["api_key"] }
 *
 * The planner is idempotent + deterministic — repeated entries are
 * deduped per model so the extension's runtime walk doesn't double-
 * encrypt a column.
 */

export interface FieldEncryptionModelFields {
  readonly [model: string]: readonly string[];
}

export function parseFieldEncryptionMap(input: string | undefined): FieldEncryptionModelFields {
  if (!input) return {};
  const result: Record<string, string[]> = {};
  for (const raw of input.split(",")) {
    const pair = raw.trim();
    if (!pair) continue;
    const dot = pair.indexOf(".");
    if (dot <= 0 || dot === pair.length - 1) continue;
    const model = pair.slice(0, dot).trim();
    const field = pair.slice(dot + 1).trim();
    if (!model || !field) continue;
    // Reject malformed identifiers — anything outside [A-Za-z0-9_]+
    // (which Prisma model + column names use) is a typo, not a
    // field encryption declaration.
    if (!/^[A-Za-z][\w]*$/.test(model)) continue;
    if (!/^[A-Za-z][\w]*$/.test(field)) continue;
    if (!result[model]) result[model] = [];
    if (!result[model].includes(field)) result[model].push(field);
  }
  return result;
}
