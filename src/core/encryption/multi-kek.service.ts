import { FieldEncryptionService } from "./field-encryption.service.js";
import type { KekProvider } from "./kek-provider.js";

/**
 * Multi-KEK Field Encryption (CF.SEC.02 / SC.SUB.12).
 *
 * Wraps the single-KEK `FieldEncryptionService` to support KEK
 * rotation — operators can demote the previous master key to a
 * legacy slot without first re-encrypting every row in the database.
 *
 * Contract:
 *   - `encrypt(plaintext)` → always uses the **primary** KEK.
 *   - `decrypt(ciphertext)` → tries the primary first; on auth-tag
 *     mismatch (wrong-key indicator), falls through legacy KEKs in
 *     declaration order until one succeeds, or throws when none do.
 *
 * Rotation procedure:
 *   1. Add the new KEK as primary; move the previous primary into
 *      the `legacy` array.
 *   2. Deploy. New encryptions land under the new KEK; existing
 *      rows continue to decrypt under their original (now-legacy)
 *      KEK on the legacy fallback path.
 *   3. (Optional) run a re-encryption pass that reads + writes every
 *      encrypted row to migrate it to the new primary. Once done,
 *      the legacy slot can be dropped on the next rotation.
 *
 * Why "try every KEK" rather than embed a key-id in the ciphertext:
 *   - Backward-compat with the existing `v1:<base64>` ciphertext
 *     format. Embedding a kid would force a `v2:` migration before
 *     rotation could even start.
 *   - GCM auth-tag rejection is the same signal whether the
 *     ciphertext is malformed or the wrong KEK was used — the
 *     wrong-key case always throws cleanly so the legacy iteration
 *     can advance without false-positive decrypts.
 */

export interface MultiKekConfig {
  readonly primary: KekProvider;
  readonly legacy: readonly KekProvider[];
}

export class MultiKekFieldEncryption {
  private readonly primaryService: FieldEncryptionService;
  private readonly legacyProviders: readonly KekProvider[];

  constructor(config: MultiKekConfig) {
    this.primaryService = new FieldEncryptionService(config.primary);
    this.legacyProviders = config.legacy;
  }

  /** Encrypt under the primary KEK only. */
  encrypt(plaintext: string): string {
    return this.primaryService.encrypt(plaintext);
  }

  /**
   * Decrypt by trying the primary KEK first, then each legacy KEK
   * in order. The first KEK that yields a valid decryption (no
   * GCM auth-tag mismatch) wins.
   *
   * Throws `MultiKekDecryptError` when no KEK succeeds — typically
   * a sign that the ciphertext was encrypted under a KEK no longer
   * tracked by the project, or that the ciphertext is malformed.
   */
  decrypt(ciphertext: string): string {
    // MIN-2: Detect malformed ciphertext early — before exhausting all
    // KEKs — by validating the `v1:` prefix and minimum payload length.
    // `FieldEncryptionService.decrypt()` already checks these and throws
    // with a message that does NOT indicate key failure. Re-check at the
    // multi-KEK layer so a structurally corrupt value is rejected
    // immediately rather than silently tried against every KEK.
    if (!isWellFormedCiphertext(ciphertext)) {
      throw new CiphertextMalformedError(
        `multi-kek: ciphertext does not match expected v1:<base64url> format`,
      );
    }
    try {
      return this.primaryService.decrypt(ciphertext);
    } catch (err) {
      // Re-throw malformed-ciphertext errors immediately — there is no
      // point trying legacy KEKs when the ciphertext itself is invalid.
      if (err instanceof CiphertextMalformedError) throw err;
      // Auth-tag mismatch (wrong key) — fall through to legacy iteration.
    }
    for (const provider of this.legacyProviders) {
      const service = new FieldEncryptionService(provider);
      try {
        return service.decrypt(ciphertext);
      } catch (err) {
        if (err instanceof CiphertextMalformedError) throw err;
        // try next legacy slot
      }
    }
    throw new MultiKekDecryptError("no KEK in the configured chain could decrypt the ciphertext");
  }
}

export class MultiKekDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultiKekDecryptError";
  }
}

/**
 * Thrown when a ciphertext is structurally invalid — wrong prefix,
 * missing colon, payload too short for the IV + auth-tag envelope.
 * Distinct from `MultiKekDecryptError` (no matching KEK) so callers
 * can distinguish corrupt data from a key-rotation gap.
 */
export class CiphertextMalformedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CiphertextMalformedError";
  }
}

/**
 * MIN-2: Validate ciphertext structure before attempting decryption.
 * Expected format: `v1:<base64url>` where the decoded payload is
 * at least IV_BYTES(12) + TAG_BYTES(16) = 28 bytes — any shorter
 * payload cannot contain a valid IV+tag+ciphertext triple.
 *
 * base64url encodes 3 bytes as 4 chars, so 28 bytes → ceil(28/3)*4 = 40
 * chars minimum. We use a conservative lower bound (> 20) to avoid
 * duplicating the exact constant and to handle padding edge cases.
 */
function isWellFormedCiphertext(value: string): boolean {
  if (typeof value !== "string") return false;
  const colon = value.indexOf(":");
  if (colon < 0) return false;
  const version = value.slice(0, colon);
  if (version !== "v1") return false;
  const payload = value.slice(colon + 1);
  // Minimum base64url length for a 28-byte payload (IV + tag, no ciphertext)
  // is ceil(28 * 4 / 3) = 38 chars (without padding). Accept > 20 as a
  // conservative lower bound.
  return payload.length > 20;
}
