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
