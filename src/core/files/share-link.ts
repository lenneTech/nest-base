import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure planner — file share-link signing + verification (CF.FILES.06
 * — iter-112).
 *
 * The PRD pins "share links" as one of the File-Manager surfaces.
 * Implementation is a stateless HMAC-SHA256 token: `<fileId>.<expiresAt>.<sig>`
 * where `<sig> = base64url(HMAC(secret, fileId + "." + expiresAt))`.
 *
 * Why not a database row: share links are short-lived (default
 * 24h), tenant-scoped, and read-only. A DB-row design would cost
 * an extra read on every download click + a cleanup cron. The
 * stateless HMAC token gives forward-revocability through the
 * secret rotation cycle (rotate the FILE_SHARE_LINK_SECRET to
 * invalidate every outstanding link).
 *
 * The token never carries the tenant id — the controller resolves
 * the file by id + cross-checks the tenant against the request's
 * (request-context) before serving bytes. That makes the link
 * tenant-safe even if a token from tenant A were guessed against
 * tenant B's file id.
 */

export interface SignShareLinkInput {
  readonly fileId: string;
  /**
   * Tenant id the file belongs to. Embedded in the token so the
   * resolve endpoint can scope its DB lookup to that tenant via the
   * `runWithRlsTenant` helper.
   */
  readonly tenantId: string;
  readonly expiresAtMs: number;
  readonly secret: string;
}

export interface VerifyShareLinkInput {
  readonly token: string;
  readonly secret: string;
  readonly nowMs: number;
}

export interface VerifiedShareLink {
  readonly fileId: string;
  readonly tenantId: string;
  readonly expiresAtMs: number;
}

export class InvalidShareLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidShareLinkError";
  }
}

export class ExpiredShareLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpiredShareLinkError";
  }
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function computeSignature(payload: string, secret: string): string {
  return base64urlEncode(createHmac("sha256", secret).update(payload).digest());
}

/**
 * Build a signed share token. Format:
 * `<fileId>.<tenantId>.<expiresAtMs>.<sig>`. The fileId + tenantId
 * are restricted to UUID-shape (no `.` collisions) — the caller
 * passes ids from the File / Tenant stores directly.
 */
export function signShareLink(input: SignShareLinkInput): string {
  if (!input.fileId.length) throw new InvalidShareLinkError("fileId is required");
  if (!input.tenantId.length) throw new InvalidShareLinkError("tenantId is required");
  if (!input.secret.length) throw new InvalidShareLinkError("secret is required");
  if (!Number.isFinite(input.expiresAtMs) || input.expiresAtMs <= 0) {
    throw new InvalidShareLinkError("expiresAtMs must be a positive number");
  }
  const payload = `${input.fileId}.${input.tenantId}.${input.expiresAtMs}`;
  const sig = computeSignature(payload, input.secret);
  return `${payload}.${sig}`;
}

/**
 * Verify a signed token. Throws `InvalidShareLinkError` on shape /
 * signature mismatch, `ExpiredShareLinkError` past the expiry. Uses
 * `timingSafeEqual` so an attacker can't gradient-descent the
 * signature byte by byte.
 */
export function verifyShareLink(input: VerifyShareLinkInput): VerifiedShareLink {
  const parts = input.token.split(".");
  if (parts.length !== 4) {
    throw new InvalidShareLinkError("token must have 4 dot-separated segments");
  }
  const [fileId, tenantId, expiresAtRaw, sig] = parts;
  if (!fileId || !tenantId || !expiresAtRaw || !sig) {
    throw new InvalidShareLinkError("token has empty segment(s)");
  }
  const expiresAtMs = Number.parseInt(expiresAtRaw, 10);
  if (!Number.isFinite(expiresAtMs)) {
    throw new InvalidShareLinkError("expiresAt segment is not numeric");
  }
  const payload = `${fileId}.${tenantId}.${expiresAtMs}`;
  const expectedSig = computeSignature(payload, input.secret);
  // timingSafeEqual requires equal-length buffers; the length-check
  // is the safe pre-filter so a comparison never short-circuits on
  // sig length and leaks a timing signal.
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new InvalidShareLinkError("signature mismatch");
  }
  if (input.nowMs >= expiresAtMs) {
    throw new ExpiredShareLinkError("token expired");
  }
  return { fileId, tenantId, expiresAtMs };
}
