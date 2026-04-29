/**
 * Output-Pipeline Stage 3 · removeSecrets.
 *
 * Strips known secret-shaped keys from outbound payloads. Walks
 * objects + arrays recursively, returns a NEW object (no mutation of
 * input). Stage 4 (`safety-net`) catches anything that slips through.
 */

export const DEFAULT_SECRET_KEYS = [
  "password",
  "passwordHash",
  "token",
  "apiKey",
  "secret",
  "authToken",
  "refreshToken",
  "sessionToken",
  "pinHash",
  "mfaSecret",
] as const;

export function removeSecrets(
  value: unknown,
  fields: readonly string[] = DEFAULT_SECRET_KEYS,
): unknown {
  const blocklist = new Set(fields.map(normalizeKey));
  return walk(value, blocklist);
}

/** Canonicalize camelCase / snake_case / SHOUT_CASE so `authToken`,
 *  `auth_token`, and `AUTH_TOKEN` all hash identically. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll("_", "");
}

function walk(value: unknown, blocklist: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, blocklist));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (blocklist.has(normalizeKey(key))) continue;
      out[key] = walk(child, blocklist);
    }
    return out;
  }
  return value;
}
