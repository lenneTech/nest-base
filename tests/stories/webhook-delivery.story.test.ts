import { describe, expect, it } from "vitest";

import {
  buildHmacSignatureHeader,
  signWebhookBody,
  verifyHmacSignatureHeader,
} from "../../src/core/webhooks/hmac-signature.js";
import {
  computeRetryDelayMs,
  shouldAutoDisable,
  WEBHOOK_RETRY_DEFAULTS,
} from "../../src/core/webhooks/retry-policy.js";

/**
 * Story · Webhook-Delivery (HMAC-Sig, Retry, Auto-Disable).
 *
 * Standard Webhooks-style delivery: HMAC-SHA256 signature with a
 * timestamp tolerance for replay protection, exponential backoff
 * across retries, automatic disable after consecutive failures.
 */
describe("Story · Webhook-Delivery", () => {
  describe("HMAC signature", () => {
    it("signWebhookBody returns base64-encoded SHA-256 HMAC of `<timestamp>.<body>`", () => {
      const sig = signWebhookBody("s3cr3t", "1700000000", '{"event":"foo"}');
      expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(sig.length).toBeGreaterThan(20);
    });

    it("signing produces a stable result", () => {
      const a = signWebhookBody("k", "1700000000", '{"x":1}');
      const b = signWebhookBody("k", "1700000000", '{"x":1}');
      expect(a).toBe(b);
    });

    it("different secret / timestamp / body yield different sigs", () => {
      const base = signWebhookBody("k", "1700000000", '{"x":1}');
      expect(signWebhookBody("other", "1700000000", '{"x":1}')).not.toBe(base);
      expect(signWebhookBody("k", "1700000001", '{"x":1}')).not.toBe(base);
      expect(signWebhookBody("k", "1700000000", '{"x":2}')).not.toBe(base);
    });

    it("buildHmacSignatureHeader / verify round-trip", () => {
      const header = buildHmacSignatureHeader("s3cr3t", "1700000000", '{"event":"foo"}');
      expect(
        verifyHmacSignatureHeader("s3cr3t", '{"event":"foo"}', header, {
          now: 1700000000,
          toleranceSeconds: 300,
        }),
      ).toBe(true);
    });

    it("verify fails on a tampered body", () => {
      const header = buildHmacSignatureHeader("k", "1700000000", '{"x":1}');
      expect(
        verifyHmacSignatureHeader("k", '{"x":2}', header, {
          now: 1700000000,
          toleranceSeconds: 300,
        }),
      ).toBe(false);
    });

    it("verify rejects timestamps outside the tolerance window (replay protection)", () => {
      const header = buildHmacSignatureHeader("k", "1700000000", '{"x":1}');
      expect(
        verifyHmacSignatureHeader("k", '{"x":1}', header, {
          now: 1700001000,
          toleranceSeconds: 300,
        }),
      ).toBe(false);
    });

    it("verify rejects malformed headers", () => {
      expect(
        verifyHmacSignatureHeader("k", "{}", "bogus", { now: 1700000000, toleranceSeconds: 300 }),
      ).toBe(false);
      expect(
        verifyHmacSignatureHeader("k", "{}", "", { now: 1700000000, toleranceSeconds: 300 }),
      ).toBe(false);
    });
  });

  describe("Retry policy", () => {
    it("exponential backoff doubles each attempt up to a cap", () => {
      const a1 = computeRetryDelayMs(1, WEBHOOK_RETRY_DEFAULTS);
      const a2 = computeRetryDelayMs(2, WEBHOOK_RETRY_DEFAULTS);
      const a3 = computeRetryDelayMs(3, WEBHOOK_RETRY_DEFAULTS);
      expect(a2).toBeGreaterThan(a1);
      expect(a3).toBeGreaterThan(a2);
    });

    it("respects the maxDelayMs cap", () => {
      const result = computeRetryDelayMs(20, WEBHOOK_RETRY_DEFAULTS);
      expect(result).toBeLessThanOrEqual(WEBHOOK_RETRY_DEFAULTS.maxDelayMs);
    });

    it("rejects non-positive attempt numbers", () => {
      expect(() => computeRetryDelayMs(0, WEBHOOK_RETRY_DEFAULTS)).toThrow();
      expect(() => computeRetryDelayMs(-1, WEBHOOK_RETRY_DEFAULTS)).toThrow();
    });

    it("shouldAutoDisable() flips at the configured failure threshold", () => {
      expect(
        shouldAutoDisable(WEBHOOK_RETRY_DEFAULTS.autoDisableAfter - 1, WEBHOOK_RETRY_DEFAULTS),
      ).toBe(false);
      expect(
        shouldAutoDisable(WEBHOOK_RETRY_DEFAULTS.autoDisableAfter, WEBHOOK_RETRY_DEFAULTS),
      ).toBe(true);
    });
  });
});
