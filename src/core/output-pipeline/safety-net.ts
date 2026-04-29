/**
 * Output-Pipeline Stage 4 · Safety-Net.
 *
 * Two layers of detection:
 *  - Field-name allowlist (default + per-call extras) catches secrets
 *    by their well-known key names (`password`, `token`, …).
 *  - Value-shape patterns catch secrets shoved into normally-safe
 *    fields (`description`, `notes`) — JWTs, our API-key prefix,
 *    long hex sequences. Patterns are opt-in via
 *    `applySafetyNet(_, { valuePatterns })`.
 *
 * Stage 3 (`removeSecrets`) handles the field-name strip. Stage 4 is
 * the regression-catcher: any leak is either masked (`mask` mode) or
 * thrown (`throw` mode). Production keeps `throw` so leaks are visible
 * in logs and tests.
 */

export const DEFAULT_SECRET_FIELD_NAMES = [
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

/**
 * Value-shape patterns that catch secrets shoved into normally-safe
 * fields. Order is "most specific first" so the common path can short-
 * circuit on the cheap regex.
 */
export const DEFAULT_SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  // JWT (header.payload.sig in base64url)
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/,
  // Our own scoped API-key plaintext format. The actual secret is
  // 32 bytes hex (64 chars), but accepting >= 8 catches the prefix
  // shape early while staying conservative on false positives.
  /\bnst_pk_[0-9a-f-]{36}_[0-9a-f]{8,}/i,
  // Stripe-style live/test keys
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/,
  // GitHub PAT prefix
  /\bghp_[A-Za-z0-9]{36}/,
  // Long lowercase hex sequence (sha256, raw API-key secret, …)
  /\b[0-9a-f]{32,}\b/,
];

export class SafetyNetViolationError extends Error {
  constructor(public readonly field: string) {
    super(`output-pipeline safety-net: secret-named field "${field}" leaked`);
    this.name = "SafetyNetViolationError";
  }
}

export type SafetyNetMode = "mask" | "throw";

export interface SafetyNetOptions {
  mode: SafetyNetMode;
  /** Field-name allowlist (default = `DEFAULT_SECRET_FIELD_NAMES`). */
  fields?: readonly string[];
  /** Value-shape regex patterns. Empty / undefined = no value-pattern check. */
  valuePatterns?: readonly RegExp[];
}

export function containsSecretField(value: unknown, fields: readonly string[]): boolean {
  return walkForFieldHit(value, normalize(fields)) !== null;
}

export function containsSecretValue(value: unknown, patterns: readonly RegExp[]): boolean {
  return walkForValueHit(value, patterns) !== null;
}

export function applySafetyNet(value: unknown, options: SafetyNetOptions): unknown {
  const fields = normalize(options.fields ?? DEFAULT_SECRET_FIELD_NAMES);
  const patterns = options.valuePatterns ?? [];

  if (options.mode === "throw") {
    const fieldHit = walkForFieldHit(value, fields);
    if (fieldHit !== null) throw new SafetyNetViolationError(fieldHit);
    if (patterns.length > 0) {
      const valueHit = walkForValueHit(value, patterns);
      if (valueHit !== null) throw new SafetyNetViolationError(valueHit);
    }
    return value;
  }

  return walkAndMask(value, fields, patterns);
}

function normalize(fields: readonly string[]): Set<string> {
  return new Set(fields.map((f) => f.toLowerCase()));
}

function walkForFieldHit(value: unknown, fields: Set<string>): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = walkForFieldHit(item, fields);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (fields.has(key.toLowerCase())) return key;
      const hit = walkForFieldHit(child, fields);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function walkForValueHit(value: unknown, patterns: readonly RegExp[]): string | null {
  if (typeof value === "string") {
    for (const pattern of patterns) {
      if (pattern.test(value)) return "<value-shape>";
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = walkForValueHit(item, patterns);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      const hit = walkForValueHit(child, patterns);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function walkAndMask(value: unknown, fields: Set<string>, patterns: readonly RegExp[]): unknown {
  if (typeof value === "string") {
    return matchesAny(value, patterns) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) return value.map((v) => walkAndMask(v, fields, patterns));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (fields.has(key.toLowerCase())) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = walkAndMask(child, fields, patterns);
    }
    return out;
  }
  return value;
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  for (const pattern of patterns) {
    if (pattern.test(value)) return true;
  }
  return false;
}
