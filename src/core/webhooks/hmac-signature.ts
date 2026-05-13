import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 signature for webhook delivery.
 *
 * Header format: `t=<unix>,v1=<base64-sig>` (Standard Webhooks-style).
 * The signed value is `<timestamp>.<body>` so a replay attack with a
 * stale body is only valid inside the timestamp tolerance window.
 */

const SCHEME_VERSION = "v1";

export function signWebhookBody(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("base64");
}

export function buildHmacSignatureHeader(secret: string, timestamp: string, body: string): string {
  return `t=${timestamp},${SCHEME_VERSION}=${signWebhookBody(secret, timestamp, body)}`;
}

export interface VerifyOptions {
  /** Current unix-second timestamp (override for tests). */
  now: number;
  /** Acceptable skew between header `t=` and `now`, in seconds. */
  toleranceSeconds: number;
}

// MIN-4: support the Standard Webhooks multi-signature header format where
// multiple `v1=<sig>` tokens may appear in a single header value, separated
// by spaces. The original regex only parsed a single v1 token.
// e.g. "t=1234567890,v1=sig1 v1=sig2" — at least one token must match.
const TIMESTAMP_RE = /t=(\d+)/;
const V1_TOKEN_RE = /v1=([A-Za-z0-9+/]+=*)/g;

export function verifyHmacSignatureHeader(
  secret: string,
  body: string,
  header: string,
  options: VerifyOptions,
): boolean {
  const tMatch = TIMESTAMP_RE.exec(header);
  if (!tMatch) return false;
  const ts = Number(tMatch[1]);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(ts - options.now) > options.toleranceSeconds) return false;

  // Collect all v1= tokens — the spec allows multiple for key rotation.
  const v1Tokens = [...header.matchAll(V1_TOKEN_RE)].map((m) => m[1]!);
  if (v1Tokens.length === 0) return false;

  const expected = signWebhookBody(secret, String(ts), body);
  const expectedBuf = Buffer.from(expected, "base64");

  // Verification passes if at least one token matches (timing-safe comparison).
  return v1Tokens.some((sig) => {
    const sigBuf = Buffer.from(sig, "base64");
    if (expectedBuf.length !== sigBuf.length) return false;
    return timingSafeEqual(expectedBuf, sigBuf);
  });
}
