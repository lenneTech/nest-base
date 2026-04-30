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

const HEADER_RE = /^t=(\d+),v1=([A-Za-z0-9+/]+=*)$/;

export function verifyHmacSignatureHeader(
  secret: string,
  body: string,
  header: string,
  options: VerifyOptions,
): boolean {
  const match = HEADER_RE.exec(header);
  if (!match) return false;
  const ts = Number(match[1]);
  const sig = match[2]!;
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(ts - options.now) > options.toleranceSeconds) return false;

  const expected = signWebhookBody(secret, String(ts), body);
  const a = Buffer.from(expected, "base64");
  const b = Buffer.from(sig, "base64");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
