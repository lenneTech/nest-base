import { describe, expect, it } from 'vitest';

import {
  ThrottleBucketKeyMissingError,
  buildThrottleBucketKey,
  type ThrottleBucketSubject,
} from '../../src/core/throttler/bucket-key.js';

/**
 * Story · Per-API-Key throttle bucket-key (PLAN.md §32 Phase 8).
 *
 * The throttler service is bucket-key-agnostic — the caller decides
 * how to identify "the same actor" across requests. PLAN.md asks for
 * three identity tiers:
 *
 *   1. API-Key ID (when present) — a service account each get their
 *      own quota independent of the human user that owns them.
 *   2. User ID (authenticated session) — a real user authenticated
 *      through Better-Auth.
 *   3. IP address (fallback for anonymous traffic).
 *
 * Whichever tier resolves first wins; mixing tiers in a single key
 * would let an attacker dilute their bucket by alternating between
 * API key + IP. The route also participates in the key so a single
 * bucket-busting endpoint can't drain quota for unrelated routes.
 */
describe('Story · Throttle bucket key', () => {
  function subject(overrides: Partial<ThrottleBucketSubject> = {}): ThrottleBucketSubject {
    return { method: 'POST', path: '/projects', ...overrides };
  }

  describe('identity priority', () => {
    it('uses the API-Key ID when present (highest priority)', () => {
      const key = buildThrottleBucketKey(subject({ apiKeyId: 'ak-1', userId: 'u-1', ip: '10.0.0.1' }));
      expect(key).toContain('apiKey:ak-1');
      expect(key).not.toContain('user:u-1');
      expect(key).not.toContain('ip:');
    });

    it('falls back to the user ID when no API-Key', () => {
      const key = buildThrottleBucketKey(subject({ userId: 'u-1', ip: '10.0.0.1' }));
      expect(key).toContain('user:u-1');
      expect(key).not.toContain('ip:');
    });

    it('falls back to IP when no API-Key and no user', () => {
      const key = buildThrottleBucketKey(subject({ ip: '10.0.0.1' }));
      expect(key).toContain('ip:10.0.0.1');
    });

    it('throws when nothing identifies the request (footgun guard)', () => {
      expect(() => buildThrottleBucketKey(subject({}))).toThrow(ThrottleBucketKeyMissingError);
    });
  });

  describe('route participation', () => {
    it('embeds method + path so different routes do not share buckets', () => {
      const a = buildThrottleBucketKey(subject({ method: 'POST', path: '/projects', userId: 'u-1' }));
      const b = buildThrottleBucketKey(subject({ method: 'GET', path: '/projects', userId: 'u-1' }));
      const c = buildThrottleBucketKey(subject({ method: 'POST', path: '/orders', userId: 'u-1' }));
      expect(a).not.toBe(b);
      expect(a).not.toBe(c);
    });

    it('upper-cases the method so case-fluctuation does not split buckets', () => {
      const lower = buildThrottleBucketKey(subject({ method: 'post', userId: 'u-1' }));
      const upper = buildThrottleBucketKey(subject({ method: 'POST', userId: 'u-1' }));
      expect(lower).toBe(upper);
    });
  });

  describe('determinism', () => {
    it('produces the same key for the same subject', () => {
      const a = buildThrottleBucketKey(subject({ apiKeyId: 'ak-1' }));
      const b = buildThrottleBucketKey(subject({ apiKeyId: 'ak-1' }));
      expect(a).toBe(b);
    });

    it('different API-Key IDs yield different keys', () => {
      const a = buildThrottleBucketKey(subject({ apiKeyId: 'ak-1' }));
      const b = buildThrottleBucketKey(subject({ apiKeyId: 'ak-2' }));
      expect(a).not.toBe(b);
    });

    it('different users yield different keys (when no API-Key)', () => {
      const a = buildThrottleBucketKey(subject({ userId: 'u-1' }));
      const b = buildThrottleBucketKey(subject({ userId: 'u-2' }));
      expect(a).not.toBe(b);
    });

    it('different IPs yield different keys (anonymous fallback)', () => {
      const a = buildThrottleBucketKey(subject({ ip: '10.0.0.1' }));
      const b = buildThrottleBucketKey(subject({ ip: '10.0.0.2' }));
      expect(a).not.toBe(b);
    });
  });

  describe('shape', () => {
    it('uses colons as the field separator (compact, no JSON overhead)', () => {
      const key = buildThrottleBucketKey(subject({ apiKeyId: 'ak-1' }));
      expect(key).toContain(':');
      expect(key).not.toContain('{');
    });

    it('starts with the identity tier prefix so logs are scannable', () => {
      expect(buildThrottleBucketKey(subject({ apiKeyId: 'ak-1' }))).toMatch(/^apiKey:/);
      expect(buildThrottleBucketKey(subject({ userId: 'u-1' }))).toMatch(/^user:/);
      expect(buildThrottleBucketKey(subject({ ip: '1.2.3.4' }))).toMatch(/^ip:/);
    });
  });
});
