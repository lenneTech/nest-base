/**
 * Throttle bucket-key derivation — per-API-key rate-limit bucket.
 *
 * The throttler service is bucket-key-agnostic; the caller decides
 * how to identify "the same actor" across requests. This builder
 * applies a three-tier priority:
 *
 *   1. apiKeyId — service accounts get their own quota
 *   2. userId   — authenticated session
 *   3. ip       — anonymous fallback
 *
 * Whichever tier resolves first wins. Mixing tiers in a single key
 * would let an attacker dilute their bucket by alternating between
 * (apiKey, IP), so the function picks one and ignores the others.
 *
 * Method + path participate so a single bucket-busting endpoint
 * can't drain quota for unrelated routes; method is upper-cased so
 * `post`/`POST` don't end up in different buckets.
 */

export interface ThrottleBucketSubject {
  method: string;
  path: string;
  apiKeyId?: string;
  userId?: string;
  ip?: string;
}

export class ThrottleBucketKeyMissingError extends Error {
  constructor() {
    super("throttler: bucket key requires at least one of apiKeyId / userId / ip");
    this.name = "ThrottleBucketKeyMissingError";
  }
}

/**
 * SECURITY NOTE (MAJ-5 — IP spoofing via X-Forwarded-For):
 *
 * The `ip` value MUST come from a validated, trusted source. When using
 * Express `req.ip`, ensure `trust proxy` is configured to trust only your
 * load-balancer (e.g. `app.set("trust proxy", 1)`, NOT `true`). Setting
 * `trust proxy: true` causes Express to read the leftmost value from
 * `X-Forwarded-For`, which an attacker can forge freely — allowing
 * bucket-key spoofing (one client appearing as many IPs, each with
 * a fresh quota window).
 *
 * The correct approach when behind a single proxy layer:
 *   - `trust proxy: 1` — Express takes the rightmost value added by the
 *     trusted proxy, which the client cannot control.
 *
 * If the deployment adds multiple proxy hops, set `trust proxy: N` where
 * N is the number of trusted proxy hops. See OPEN_QUESTIONS.md for details.
 */
export function buildThrottleBucketKey(subject: ThrottleBucketSubject): string {
  const identity = pickIdentity(subject);
  const method = subject.method.toUpperCase();
  return `${identity}:${method}:${subject.path}`;
}

function pickIdentity(subject: ThrottleBucketSubject): string {
  if (subject.apiKeyId) return `apiKey:${subject.apiKeyId}`;
  if (subject.userId) return `user:${subject.userId}`;
  if (subject.ip) return `ip:${subject.ip}`;
  throw new ThrottleBucketKeyMissingError();
}
