/**
 * Stateless HMAC-based CSRF token used by the webhook inspector
 * re-deliver action.
 *
 * The token is `<payload>.<signature>` where:
 *   - payload  = base64url(<unix-seconds-issued>:<random-nonce>)
 *   - signature = base64url(HMAC-SHA256(secret, payload))
 *
 * Verification re-derives the signature and compares with
 * `timingSafeEqual`. The freshness check rejects payloads older than
 * `ttlSeconds`. No session storage is required — the secret is loaded
 * once at boot from an env var (or auto-generated for dev).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface IssueCsrfTokenInput {
  secret: string;
  /** Override for tests; defaults to the wall clock. */
  now?: number;
}

export interface VerifyCsrfTokenInput {
  token: string;
  secret: string;
  now: number;
  ttlSeconds: number;
}

export function issueCsrfToken(input: IssueCsrfTokenInput): string {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString("hex");
  const payload = encodeBase64Url(`${now}:${nonce}`);
  const sig = signPayload(input.secret, payload);
  return `${payload}.${sig}`;
}

export function verifyCsrfToken(input: VerifyCsrfTokenInput): boolean {
  const dot = input.token.indexOf(".");
  if (dot <= 0 || dot === input.token.length - 1) return false;
  const payload = input.token.slice(0, dot);
  const provided = input.token.slice(dot + 1);

  const expected = signPayload(input.secret, payload);
  // base64url is ASCII-safe; equal-length comparison is enough.
  if (expected.length !== provided.length) return false;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) return false;

  // Decode and check freshness.
  let decoded: string;
  try {
    decoded = decodeBase64Url(payload);
  } catch {
    return false;
  }
  const colon = decoded.indexOf(":");
  if (colon <= 0) return false;
  const issuedAt = Number(decoded.slice(0, colon));
  if (!Number.isFinite(issuedAt)) return false;
  if (input.now - issuedAt > input.ttlSeconds) return false;
  if (issuedAt - input.now > 60) return false;
  return true;
}

function signPayload(secret: string, payload: string): string {
  return createHmac("sha256", secret)
    .update(payload)
    .digest("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function decodeBase64Url(value: string): string {
  const padding = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + padding;
  return Buffer.from(normalized, "base64").toString("utf8");
}
