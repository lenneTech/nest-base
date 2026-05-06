import { createHmac } from "node:crypto";

/**
 * Blind-index helper for searchable encrypted fields (CF.SEC.04).
 *
 * The PRD pins "AES-256-GCM field encryption + KEK rotation +
 * blind index for searchable encrypted fields". The encryption
 * + KEK paths exist (`field-encryption.service.ts` + `multi-kek.service.ts`);
 * blind-index is the third leg.
 *
 * Why a blind index: AES-GCM ciphertext is non-deterministic by
 * design — two encryptions of the same plaintext produce different
 * bytes (different IV per call). That makes equality lookups
 * (`WHERE email = $1`) impossible against the ciphertext column.
 * The blind index sidesteps this:
 *
 *   - Compute `HMAC-SHA256(blindIndexKey, normalise(plaintext))`
 *   - Store the truncated hex digest alongside the ciphertext as a
 *     separate `<field>_blind` column
 *   - Equality lookups query against `<field>_blind` (the
 *     deterministic HMAC), not the ciphertext
 *
 * Tradeoff: a blind index leaks plaintext-equality (two rows with
 * the same email produce the same blind value) — but it does NOT
 * leak the plaintext itself (HMAC is one-way given the key). The
 * security model assumes the blindIndexKey is rotated separately
 * from the KEK + stored in a different secret store; an attacker
 * with DB read-only never gets to brute-force the HMAC.
 *
 * Normalisation: case-folded + trim. Email-equality typically wants
 * `alice@EXAMPLE.com` to match `Alice@example.com`. Phone numbers
 * the project should pre-normalise via libphonenumber before
 * passing to `compute()`.
 */

export interface BlindIndexOptions {
  /**
   * 32+ byte key the project rotates separately from the KEK. A
   * fresh key rotates the blind index — existing rows must be
   * re-indexed via the data-migration runner.
   */
  readonly key: Uint8Array;
  /**
   * Truncate the hex digest to N chars. Default 32 (16 bytes / 128
   * bits — birthday-resistant for tens of millions of values).
   * Higher = lower false-positive rate; lower = smaller index.
   */
  readonly truncateChars?: number;
}

const MIN_KEY_BYTES = 32;
const DEFAULT_TRUNCATE_CHARS = 32;

export class BlindIndex {
  private readonly key: Uint8Array;
  private readonly truncateChars: number;

  constructor(options: BlindIndexOptions) {
    if (options.key.length < MIN_KEY_BYTES) {
      throw new Error(
        `blind-index: key must be at least ${MIN_KEY_BYTES} bytes (received: ${options.key.length})`,
      );
    }
    if (options.truncateChars !== undefined) {
      if (
        !Number.isInteger(options.truncateChars) ||
        options.truncateChars < 8 ||
        options.truncateChars > 64
      ) {
        throw new Error(
          `blind-index: truncateChars must be an integer in [8, 64] (received: ${options.truncateChars})`,
        );
      }
    }
    this.key = options.key;
    this.truncateChars = options.truncateChars ?? DEFAULT_TRUNCATE_CHARS;
  }

  /**
   * Compute the deterministic HMAC for a plaintext value. Output
   * is a lowercase hex string of `truncateChars` characters.
   *
   * Returns `null` for empty / nullish inputs — null-friendly
   * lookup queries can do `WHERE email_blind IS NULL` for "no
   * email on file" rows without colliding with empty-string
   * computations.
   */
  compute(plaintext: string | null | undefined): string | null {
    if (plaintext === null || plaintext === undefined) return null;
    const normalised = normalise(plaintext);
    if (normalised.length === 0) return null;
    const hmac = createHmac("sha256", this.key);
    hmac.update(normalised, "utf8");
    return hmac.digest("hex").slice(0, this.truncateChars);
  }

  /**
   * Same as `compute()` but takes an iterable so callers building
   * batch-update queries don't repeat the loop. Preserves order;
   * null entries map to null.
   */
  computeMany(plaintexts: Iterable<string | null | undefined>): readonly (string | null)[] {
    const out: (string | null)[] = [];
    for (const value of plaintexts) {
      out.push(this.compute(value));
    }
    return out;
  }
}

/**
 * Normalisation step — case-fold + trim. Project code can extend
 * this for domain-specific normalisation (libphonenumber for phone
 * numbers, NFC unicode normalisation for non-ASCII names) by
 * pre-processing the value before passing it to `compute()`.
 */
function normalise(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * DI token for the project's `BlindIndex` provider. Bound at
 * `EncryptionModule.forRoot()` time when the
 * `BLIND_INDEX_KEY` env var is supplied.
 */
export const BLIND_INDEX = Symbol.for("lt:BlindIndex");

/**
 * Pure planner — partitions a candidate `BLIND_INDEX_KEY` env
 * value into (a) accepted (returns a `BlindIndex` instance), (b)
 * rejected (returns the reason). Keeps the `EncryptionModule`
 * factory testable without mounting Nest.
 */
export function planBlindIndexFromEnv(envValue: string | undefined): BlindIndexPlan {
  if (envValue === undefined || envValue.trim().length === 0) {
    return { kind: "absent" };
  }
  // Accept either base64url (44 chars for 32 bytes) or hex (64 chars
  // for 32 bytes). Anything else is rejected with a descriptive
  // reason so the env-prerequisite banner can route the user.
  const hexMatch = /^[0-9a-fA-F]+$/.test(envValue);
  if (hexMatch && envValue.length % 2 === 0) {
    const buf = Buffer.from(envValue, "hex");
    if (buf.length < MIN_KEY_BYTES) {
      return {
        kind: "rejected",
        reason: `BLIND_INDEX_KEY hex value must decode to at least ${MIN_KEY_BYTES} bytes (got ${buf.length})`,
      };
    }
    return { kind: "accepted", key: new Uint8Array(buf) };
  }
  // Try base64 / base64url.
  try {
    const buf = Buffer.from(envValue, "base64");
    if (buf.length < MIN_KEY_BYTES) {
      return {
        kind: "rejected",
        reason: `BLIND_INDEX_KEY base64 value must decode to at least ${MIN_KEY_BYTES} bytes (got ${buf.length})`,
      };
    }
    return { kind: "accepted", key: new Uint8Array(buf) };
  } catch {
    return {
      kind: "rejected",
      reason: "BLIND_INDEX_KEY could not be parsed as base64 or hex — supply a 32+ byte key",
    };
  }
}

export type BlindIndexPlan =
  | { readonly kind: "absent" }
  | { readonly kind: "accepted"; readonly key: Uint8Array }
  | { readonly kind: "rejected"; readonly reason: string };
