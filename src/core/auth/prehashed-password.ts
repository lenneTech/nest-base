/**
 * Sentinel prefix that SDK clients prepend to a locally-computed
 * SHA-256 digest before transmitting the password field. The server's
 * character-class entropy check would otherwise reject a 64-char
 * lowercase hex string (only one class present) even though the
 * underlying password may be arbitrarily strong.
 */
export const PRE_HASH_PREFIX = "sha256:";

// sha256: followed by exactly 64 lowercase hex chars — the only
// shape that unambiguously signals a client-side pre-hash.
const PRE_HASH_RE = /^sha256:[0-9a-f]{64}$/;

/**
 * Returns true when `value` carries the `sha256:<64-char-hex>` sentinel
 * that trusted SDK clients use to signal a locally-computed SHA-256
 * digest. Uppercase hex chars are rejected because SHA-256 digests
 * produced by the reference SDK are always lowercase.
 */
export function isPreHashedSha256(value: string): boolean {
  return PRE_HASH_RE.test(value);
}
