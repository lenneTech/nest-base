import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SECRET_VALUE_PATTERNS,
  applySafetyNet,
  containsSecretValue,
  SafetyNetViolationError,
} from '../../src/core/output-pipeline/safety-net.js';

/**
 * Output-Pipeline Stage 4 (extended) — Regex value-patterns.
 *
 * Key-name detection misses cases where a developer shoved a secret
 * into a normally-safe field (`description`, `comment`, `notes`).
 * Value-pattern matching catches the obvious shapes (JWTs, API-key
 * prefixes, long hex). The framework ships a default pattern list;
 * projects can extend it without losing the framework patterns.
 */
describe('Output-Pipeline · Safety-Net value patterns', () => {
  it('default pattern list covers JWT, our nst_pk_ prefix, long hex sequences', () => {
    const patterns = DEFAULT_SECRET_VALUE_PATTERNS;
    // a JWT triggers
    expect(patterns.some((re) => re.test('eyJhbGciOi.eyJzdWIiOi.SflKxwRJSMeKKF'))).toBe(true);
    // our nst_pk_<lookup>_<secret> prefix triggers
    expect(patterns.some((re) => re.test('nst_pk_00000000-0000-7000-8000-000000000000_aabbccdd'))).toBe(true);
    // 64 lowercase hex chars (sha256 / api-key-secret) trigger
    expect(patterns.some((re) => re.test('a'.repeat(64)))).toBe(true);
    // safe values do not trigger
    expect(patterns.some((re) => re.test('hello world'))).toBe(false);
    expect(patterns.some((re) => re.test('user@example.com'))).toBe(false);
  });

  describe('containsSecretValue()', () => {
    it('detects a JWT in a `description` field where key-name detection misses', () => {
      expect(
        containsSecretValue(
          { description: 'see token: eyJhbGciOi.eyJzdWIiOi.SflKxwRJSMeKKF' },
          DEFAULT_SECRET_VALUE_PATTERNS,
        ),
      ).toBe(true);
    });

    it('walks nested objects + arrays', () => {
      expect(
        containsSecretValue(
          { user: { notes: 'eyJhbGciOi.eyJzdWIiOi.SflKxwRJSMeKKF' } },
          DEFAULT_SECRET_VALUE_PATTERNS,
        ),
      ).toBe(true);
      expect(
        containsSecretValue([{ comment: 'a'.repeat(64) }], DEFAULT_SECRET_VALUE_PATTERNS),
      ).toBe(true);
    });

    it('returns false on safe payloads', () => {
      expect(
        containsSecretValue({ id: '1', email: 'a@x.com', count: 42 }, DEFAULT_SECRET_VALUE_PATTERNS),
      ).toBe(false);
    });
  });

  describe('applySafetyNet() · combined fields + patterns', () => {
    it('throw mode flags a JWT-in-description even though `description` is not a secret-named key', () => {
      expect(() =>
        applySafetyNet(
          { description: 'eyJhbGciOi.eyJzdWIiOi.SflKxwRJSMeKKF' },
          { mode: 'throw', valuePatterns: DEFAULT_SECRET_VALUE_PATTERNS },
        ),
      ).toThrow(SafetyNetViolationError);
    });

    it('mask mode redacts a value-pattern hit', () => {
      const out = applySafetyNet(
        { id: '1', notes: 'eyJhbGciOi.eyJzdWIiOi.SflKxwRJSMeKKF' },
        { mode: 'mask', valuePatterns: DEFAULT_SECRET_VALUE_PATTERNS },
      );
      expect(out).toEqual({ id: '1', notes: '[redacted]' });
    });

    it('honors a project-extra pattern alongside the defaults', () => {
      const projectPattern = /^company-secret:/;
      const out = applySafetyNet(
        { id: '1', notes: 'company-secret:42' },
        { mode: 'mask', valuePatterns: [...DEFAULT_SECRET_VALUE_PATTERNS, projectPattern] },
      );
      expect(out).toEqual({ id: '1', notes: '[redacted]' });
    });

    it('does NOT trigger when the value contains the pattern but is shorter than the threshold', () => {
      const out = applySafetyNet(
        { id: '1', notes: 'aabbccdd' }, // 8 hex chars — below 32-char threshold
        { mode: 'mask', valuePatterns: DEFAULT_SECRET_VALUE_PATTERNS },
      );
      expect(out).toEqual({ id: '1', notes: 'aabbccdd' });
    });
  });
});
