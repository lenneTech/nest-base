import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 token helpers for `signUrl()` in local + postgres storage
 * adapters (CRIT-2 fix).
 *
 * Without a signature any caller who knows a file key can craft an
 * arbitrary `?expires=<ts>` query string. The token binds `key` + `expires`
 * to the secret so the server can verify the URL was issued by itself.
 *
 * Secret resolution (highest priority first):
 *   1. `FILE_SHARE_LINK_SECRET` env var
 *   2. `BETTER_AUTH_SECRET` env var (fallback — re-uses the existing secret)
 *   3. `undefined` (dev-mode: no secret, no signature, no verification)
 *
 * Dev-mode behaviour: when no secret is configured the adapters generate
 * URLs without a `sig` parameter and the controller skips verification.
 * This preserves backward-compatibility for local development without a
 * configured secret.
 */

export function resolveSignSecret(): string | undefined {
  return process.env["FILE_SHARE_LINK_SECRET"] ?? process.env["BETTER_AUTH_SECRET"] ?? undefined;
}

/**
 * Generate a 32-character hex HMAC token over `"${key}.${expires}"`.
 * The token is appended as `?sig=<token>` to the signed URL.
 */
export function signUrlToken(key: string, expires: number, secret: string): string {
  return createHmac("sha256", secret).update(`${key}.${expires}`).digest("hex").slice(0, 32);
}

/**
 * Verify the `sig` parameter produced by `signUrlToken`.
 *
 * Returns `true` when the signature is valid or when `secret` is `undefined`
 * (dev-mode — no verification). Returns `false` on mismatch.
 *
 * Uses `timingSafeEqual` to prevent timing-based signature enumeration.
 */
export function verifySignUrlToken(
  key: string,
  expires: number,
  sig: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) {
    // Dev-mode: no secret configured — skip verification so existing
    // signed URLs without a sig parameter continue to work.
    return true;
  }
  if (!sig) {
    // A secret is configured but the URL carries no sig — reject.
    return false;
  }
  const expected = signUrlToken(key, expires, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
