import { describe, expect, it } from "vitest";

/**
 * Story · Email per-recipient rate limiter (CF.EMAIL.11).
 *
 * The PRD's `CF.EMAIL.11` requires a per-recipient sliding-window
 * rate guard. Its primary job is to break tight-loop bugs that
 * would otherwise spam the same address — not to absorb a
 * sophisticated abuser.
 *
 * Design contract:
 *   - Sliding window keyed by lowercased email.
 *   - `limit === 0` disables the limiter completely.
 *   - Bounded LRU keeps memory linear under sustained traffic.
 *   - Injectable clock for deterministic tests.
 *   - `consume()` is "check + record": records the timestamp on
 *     success, returns retryAt on rejection.
 *   - `status()` peeks without recording.
 */
describe("Story · Email per-recipient rate limiter", () => {
  describe("consume() — happy paths", () => {
    it("permits sends below the limit and records each one", async () => {
      const { RecipientRateLimiter } =
        await import("../../src/core/email/recipient-rate-limiter.js");
      let now = 1_000_000;
      const limiter = new RecipientRateLimiter({
        limit: 3,
        windowMs: 60_000,
        maxEntries: 100,
        clock: () => now,
      });

      const a = limiter.consume("alice@example.com");
      expect(a.allowed).toBe(true);
      expect(a.count).toBe(1);

      now += 100;
      const b = limiter.consume("alice@example.com");
      expect(b.allowed).toBe(true);
      expect(b.count).toBe(2);

      now += 100;
      const c = limiter.consume("alice@example.com");
      expect(c.allowed).toBe(true);
      expect(c.count).toBe(3);
    });

    it("rejects the (limit+1)-th send and reports retryAt", async () => {
      const { RecipientRateLimiter } =
        await import("../../src/core/email/recipient-rate-limiter.js");
      let now = 1_000_000;
      const limiter = new RecipientRateLimiter({
        limit: 2,
        windowMs: 60_000,
        maxEntries: 100,
        clock: () => now,
      });

      limiter.consume("bob@example.com");
      now += 1_000;
      limiter.consume("bob@example.com");
      now += 1_000;
      const denied = limiter.consume("bob@example.com");

      expect(denied.allowed).toBe(false);
      expect(denied.count).toBe(2);
      // First send was at 1_000_000; window is 60_000ms; retryAt = 1_060_000
      expect(denied.retryAt).toBe(1_060_000);
    });

    it("isolates recipients (alice's cap does not affect bob)", async () => {
      const { RecipientRateLimiter } =
        await import("../../src/core/email/recipient-rate-limiter.js");
      const limiter = new RecipientRateLimiter({
        limit: 1,
        windowMs: 60_000,
        maxEntries: 100,
      });
      expect(limiter.consume("alice@example.com").allowed).toBe(true);
      expect(limiter.consume("alice@example.com").allowed).toBe(false);
      expect(limiter.consume("bob@example.com").allowed).toBe(true);
    });

    it("frees up capacity when the window slides past the oldest entry", async () => {
      const { RecipientRateLimiter } =
        await import("../../src/core/email/recipient-rate-limiter.js");
      let now = 1_000_000;
      const limiter = new RecipientRateLimiter({
        limit: 1,
        windowMs: 60_000,
        maxEntries: 100,
        clock: () => now,
      });

      expect(limiter.consume("alice@example.com").allowed).toBe(true);
      now += 30_000;
      expect(limiter.consume("alice@example.com").allowed).toBe(false);
      // Slide past the 60s window
      now += 31_000;
      expect(limiter.consume("alice@example.com").allowed).toBe(true);
    });
  });

  describe("normalisation + edge cases", () => {
    it("normalises email to lowercase + trim", async () => {
      const { RecipientRateLimiter } =
        await import("../../src/core/email/recipient-rate-limiter.js");
      const limiter = new RecipientRateLimiter({
        limit: 1,
        windowMs: 60_000,
        maxEntries: 100,
      });
      expect(limiter.consume(" Alice@Example.COM ").allowed).toBe(true);
      expect(limiter.consume("alice@example.com").allowed).toBe(false);
    });

    it("disables the limiter when limit <= 0", async () => {
      const { RecipientRateLimiter } =
        await import("../../src/core/email/recipient-rate-limiter.js");
      const limiter = new RecipientRateLimiter({
        limit: 0,
        windowMs: 60_000,
        maxEntries: 100,
      });
      for (let i = 0; i < 10; i++) {
        const result = limiter.consume("anyone@example.com");
        expect(result.allowed).toBe(true);
        expect(result.count).toBe(0);
      }
    });

    it("status() peeks without recording", async () => {
      const { RecipientRateLimiter } =
        await import("../../src/core/email/recipient-rate-limiter.js");
      const limiter = new RecipientRateLimiter({
        limit: 3,
        windowMs: 60_000,
        maxEntries: 100,
      });
      limiter.consume("alice@example.com");
      const peek = limiter.status("alice@example.com");
      expect(peek.count).toBe(1);
      expect(peek.allowed).toBe(true);
      // status() does not increment
      const peekAgain = limiter.status("alice@example.com");
      expect(peekAgain.count).toBe(1);
    });

    it("reset() drops every record", async () => {
      const { RecipientRateLimiter } =
        await import("../../src/core/email/recipient-rate-limiter.js");
      const limiter = new RecipientRateLimiter({
        limit: 1,
        windowMs: 60_000,
        maxEntries: 100,
      });
      expect(limiter.consume("alice@example.com").allowed).toBe(true);
      expect(limiter.consume("alice@example.com").allowed).toBe(false);
      limiter.reset();
      expect(limiter.consume("alice@example.com").allowed).toBe(true);
    });
  });

  describe("LRU eviction", () => {
    it("evicts the oldest recipient when maxEntries is exceeded", async () => {
      const { RecipientRateLimiter } =
        await import("../../src/core/email/recipient-rate-limiter.js");
      const limiter = new RecipientRateLimiter({
        limit: 1,
        windowMs: 60_000,
        maxEntries: 2,
      });
      // Fill: LRU = [a, b]
      limiter.consume("a@example.com");
      limiter.consume("b@example.com");
      // c@ evicts a@ (oldest). LRU = [b, c]
      limiter.consume("c@example.com");
      // a@ was evicted → re-consume is "first send" again. This evicts b@.
      // LRU = [c, a]
      expect(limiter.consume("a@example.com").allowed).toBe(true);
      // c@ is still tracked from its first send; second consume is denied.
      expect(limiter.consume("c@example.com").allowed).toBe(false);
    });
  });
});
