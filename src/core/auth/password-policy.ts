import { createHash } from "node:crypto";

/**
 * Password policy (CF.AUTH.passwordPolicy).
 *
 * The PRD pins "Password policy (entropy + breach checks)". This
 * module provides three composable units:
 *
 *  1. `estimatePasswordEntropy(password)` — pure planner returning a
 *     Shannon-bit estimate based on character-class diversity. Long +
 *     varied passwords score high; short + single-class passwords
 *     score low. Used by both Better-Auth signup hooks and project
 *     change-password flows.
 *
 *  2. `buildHibpBreachCheck({fetchRange})` — async checker that
 *     queries the public Have-I-Been-Pwned k-anonymity API. The
 *     password is SHA-1 hashed locally; only the first 5 hex chars
 *     of the digest leave the process. The endpoint returns every
 *     matching suffix + occurrence count; we scan locally for the
 *     remaining 35 chars.
 *
 *  3. `validatePasswordPolicy(password, options, breachCheck?)` —
 *     composes (1) + (2). Throws `PasswordPolicyError` with a
 *     discriminated `reason` so callers can route the rejection.
 *
 * The transport (`fetchRange`) is injectable so tests can spy + a
 * project that mirrors HIBP internally swaps it in trivially.
 */

const LOWERCASE = /[a-z]/;
const UPPERCASE = /[A-Z]/;
const DIGITS = /[0-9]/;
const SYMBOLS = /[^a-zA-Z0-9]/;

/**
 * Estimate Shannon-bit entropy of a password. Heuristic — counts
 * character classes present and applies `length * log2(alphabetSize)`.
 * Not a substitute for zxcvbn but vastly cheaper and good enough for
 * "is this above the policy floor" decisions.
 *
 * Alphabet sizes:
 *   - lowercase only (26)         → 4.7 bits/char
 *   - + uppercase (52)            → 5.7 bits/char
 *   - + digits (62)               → 5.95 bits/char
 *   - + symbols (95)              → 6.57 bits/char
 *
 * Empty string returns 0.
 */
export function estimatePasswordEntropy(password: string): number {
  if (password.length === 0) return 0;
  let alphabetSize = 0;
  if (LOWERCASE.test(password)) alphabetSize += 26;
  if (UPPERCASE.test(password)) alphabetSize += 26;
  if (DIGITS.test(password)) alphabetSize += 10;
  if (SYMBOLS.test(password)) alphabetSize += 33;
  if (alphabetSize === 0) return 0;
  return password.length * Math.log2(alphabetSize);
}

export interface HibpRangeEntry {
  /** 35-char hex suffix (the SHA-1 digest minus the leading 5 chars). */
  readonly suffix: string;
  /** Number of times this hash appears in HIBP's breach corpus. */
  readonly count: number;
}

export interface HibpBreachCheckInput {
  /**
   * Fetches the HIBP range response for a given 5-char prefix. The
   * caller is responsible for transport semantics (timeout, retry,
   * cert pinning); the function returns the parsed list. Production
   * implementation: GET `https://api.pwnedpasswords.com/range/<prefix>`
   * with header `Add-Padding: true` to defeat traffic-pattern leaks,
   * parse the body into `{suffix, count}` rows.
   */
  fetchRange(prefix: string): Promise<readonly HibpRangeEntry[]>;
}

export type HibpBreachResult =
  | { readonly breached: false }
  | { readonly breached: true; readonly count: number };

/** Build an HIBP-aware breach checker. The transport is injectable. */
export function buildHibpBreachCheck(
  input: HibpBreachCheckInput,
): (password: string) => Promise<HibpBreachResult> {
  return async (password: string): Promise<HibpBreachResult> => {
    const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    const entries = await input.fetchRange(prefix);
    for (const entry of entries) {
      if (entry.suffix.toUpperCase() === suffix) {
        return { breached: true, count: entry.count };
      }
    }
    return { breached: false };
  };
}

export interface PasswordPolicyOptions {
  /** Minimum Shannon-bit entropy. Default 50 (≈ 12-char mixed-case + digit). */
  readonly minEntropyBits?: number;
}

export type PasswordPolicyReason = "entropy" | "breached";

export class PasswordPolicyError extends Error {
  constructor(
    message: string,
    public readonly reason: PasswordPolicyReason,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

const DEFAULT_MIN_ENTROPY_BITS = 50;

/**
 * Validate a password against the project's policy. Throws
 * `PasswordPolicyError(reason)` on reject:
 *  - `reason: "entropy"` — below the configured minEntropyBits
 *  - `reason: "breached"` — found in HIBP's breach corpus
 *
 * `breachCheck` is optional so projects without internet egress can
 * still validate entropy locally.
 */
export async function validatePasswordPolicy(
  password: string,
  options: PasswordPolicyOptions = {},
  breachCheck?: (password: string) => Promise<HibpBreachResult>,
): Promise<void> {
  const min = options.minEntropyBits ?? DEFAULT_MIN_ENTROPY_BITS;
  const entropy = estimatePasswordEntropy(password);
  if (entropy < min) {
    throw new PasswordPolicyError(
      `password entropy ${entropy.toFixed(1)} bits is below the policy floor of ${min} bits`,
      "entropy",
      { entropy, min },
    );
  }
  if (breachCheck) {
    const result = await breachCheck(password);
    if (result.breached) {
      throw new PasswordPolicyError(
        `password is on the Have-I-Been-Pwned breach list (count=${result.count})`,
        "breached",
        { count: result.count },
      );
    }
  }
}

/**
 * Pure parser for the HIBP range-API body. Each line is
 * `<suffix>:<count>`. Empty / malformed lines are skipped so a
 * partial-corruption response still surfaces every well-formed
 * entry. Exported so tests can drive the parsing branches without
 * a network roundtrip.
 */
export function parseHibpRangeBody(body: string): readonly HibpRangeEntry[] {
  const entries: HibpRangeEntry[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const suffix = trimmed.slice(0, colon);
    const count = Number.parseInt(trimmed.slice(colon + 1), 10);
    if (Number.isNaN(count)) continue;
    entries.push({ suffix, count });
  }
  return entries;
}

/**
 * Default fetch-based HIBP transport — uses native `fetch` to call
 * `https://api.pwnedpasswords.com/range/<prefix>` with the
 * `Add-Padding: true` traffic-pattern defeater header. Tests inject
 * a spy via `buildHibpBreachCheck({ fetchRange })`.
 */
export async function fetchHibpRange(prefix: string): Promise<readonly HibpRangeEntry[]> {
  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    method: "GET",
    headers: { "Add-Padding": "true" },
  });
  if (!response.ok) {
    throw new Error(`hibp: range query failed (status=${response.status})`);
  }
  const body = await response.text();
  return parseHibpRangeBody(body);
}
