import { Injectable } from "@nestjs/common";
import { createHmac, randomBytes } from "node:crypto";

/**
 * HubSessionService — lightweight, stateless Hub session management.
 *
 * Unlike the Better-Auth session (which is Postgres-backed and user-
 * centric), Hub sessions are:
 *   - Stateless: the session is a signed, expiring token stored only
 *     in the browser's HTTP-only cookie. No DB row.
 *   - Short-lived: 8-hour sliding window resets on each authenticated
 *     request.
 *   - Single-credential: the session proves the operator entered the
 *     correct Hub password; no user identity is tracked.
 *
 * Token format (URL-safe base64): `<nonce>.<expiresAt>.<hmac>`
 *   - nonce (16 random bytes): replay-resistance within the window.
 *   - expiresAt (epoch ms, 13 chars): absolute expiry.
 *   - hmac (SHA-256 of `nonce.expiresAt` keyed by the Hub secret):
 *     integrity + authenticity.
 *
 * The HMAC key is derived from the app's `BETTER_AUTH_SECRET`
 * (already required in non-local stages) with a fixed Hub prefix so
 * Hub tokens can't be confused with Better-Auth tokens.
 */

const HUB_HMAC_PREFIX = "hub-session-v1:";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

function deriveHmacKey(secret: string): string {
  return createHmac("sha256", secret).update(HUB_HMAC_PREFIX).digest("hex");
}

function signToken(nonce: string, expiresAt: number, key: string): string {
  return createHmac("sha256", key).update(`${nonce}.${expiresAt}`).digest("base64url");
}

export interface HubSessionCreateResult {
  token: string;
  expiresAt: number;
}

export interface HubSessionVerifyResult {
  valid: boolean;
  /** When valid, the refreshed token with a new 8h window. */
  refreshedToken?: string;
  /** When valid, the new expiry. */
  newExpiresAt?: number;
}

@Injectable()
export class HubSessionService {
  private readonly hmacKey: string;

  constructor() {
    // Derive from BETTER_AUTH_SECRET so no additional env var is needed.
    // In local stage the service is never called (Hub is open), but we
    // still initialize so the module loads cleanly.
    const secret = process.env.BETTER_AUTH_SECRET ?? "dev-fallback-not-for-production";
    this.hmacKey = deriveHmacKey(secret);
  }

  /**
   * Create a new signed Hub session token.
   *
   * Called after a successful password verification.
   */
  createSession(): HubSessionCreateResult {
    const nonce = randomBytes(16).toString("base64url");
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    const hmac = signToken(nonce, expiresAt, this.hmacKey);
    const token = `${nonce}.${expiresAt}.${hmac}`;
    return { token, expiresAt };
  }

  /**
   * Verify a Hub session token and slide the expiry window.
   *
   * On success, returns a refreshed token so the next response carries
   * a fresh 8h cookie. This implements the "sliding" contract from
   * issue #83.
   *
   * Returns `{ valid: false }` for any malformed, expired, or tampered
   * token.
   */
  verifyAndRefresh(token: string): HubSessionVerifyResult {
    const parts = token.split(".");
    if (parts.length !== 3) return { valid: false };

    const [nonce, expiresAtStr, hmac] = parts as [string, string, string];
    const expiresAt = Number(expiresAtStr);

    if (!Number.isFinite(expiresAt)) return { valid: false };
    if (Date.now() > expiresAt) return { valid: false };

    const expected = signToken(nonce, expiresAt, this.hmacKey);
    // Constant-time comparison to prevent timing attacks.
    if (!timingSafeEqual(hmac, expected)) return { valid: false };

    // Slide: issue a new token with a fresh 8h window.
    const refreshed = this.createSession();
    return {
      valid: true,
      refreshedToken: refreshed.token,
      newExpiresAt: refreshed.expiresAt,
    };
  }
}

/**
 * Constant-time string comparison (both strings must be the same
 * length for this to be strictly constant-time, but the HMAC output
 * is always 43 chars of base64url — this is always true in practice).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
