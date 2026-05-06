import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BLIND_INDEX,
  BlindIndex,
  planBlindIndexFromEnv,
} from "../../src/core/encryption/blind-index.js";

/**
 * Story · Blind index for searchable encrypted fields (CF.SEC.04).
 *
 * The PRD requires "AES-256-GCM field encryption + KEK rotation +
 * blind index for searchable encrypted fields". The encryption +
 * KEK paths exist (`field-encryption.service.ts` + iter-45's
 * `multi-kek.service.ts`); blind-index is the third leg.
 *
 * Three layers covered here:
 *   1. The pure HMAC primitive — same plaintext → same digest;
 *      different plaintexts → different digests
 *   2. Normalisation — case-fold + trim so equality lookups are
 *      forgiving of input whitespace / casing
 *   3. The env-parsing planner — rejects too-short keys, accepts
 *      hex or base64 encodings, surfaces a descriptive reason on
 *      malformed input
 */
const KEY = randomBytes(32);

describe("Story · BlindIndex", () => {
  describe("compute() — deterministic HMAC", () => {
    it("returns the same digest for the same plaintext", () => {
      const idx = new BlindIndex({ key: KEY });
      const a = idx.compute("alice@example.com");
      const b = idx.compute("alice@example.com");
      expect(a).toBe(b);
      expect(a).not.toBeNull();
    });

    it("returns different digests for different plaintexts", () => {
      const idx = new BlindIndex({ key: KEY });
      const a = idx.compute("alice@example.com");
      const b = idx.compute("bob@example.com");
      expect(a).not.toBe(b);
    });

    it("returns the same digest regardless of case (case-folded)", () => {
      const idx = new BlindIndex({ key: KEY });
      const a = idx.compute("Alice@Example.com");
      const b = idx.compute("alice@example.com");
      const c = idx.compute("ALICE@EXAMPLE.COM");
      expect(a).toBe(b);
      expect(b).toBe(c);
    });

    it("returns the same digest regardless of leading/trailing whitespace", () => {
      const idx = new BlindIndex({ key: KEY });
      const a = idx.compute("  alice@example.com  ");
      const b = idx.compute("alice@example.com");
      expect(a).toBe(b);
    });

    it("uses different digests for different keys (key-rotation safety)", () => {
      const idx1 = new BlindIndex({ key: randomBytes(32) });
      const idx2 = new BlindIndex({ key: randomBytes(32) });
      const a = idx1.compute("alice@example.com");
      const b = idx2.compute("alice@example.com");
      expect(a).not.toBe(b);
    });

    it("returns null for null / undefined / empty / whitespace-only inputs", () => {
      const idx = new BlindIndex({ key: KEY });
      expect(idx.compute(null)).toBeNull();
      expect(idx.compute(undefined)).toBeNull();
      expect(idx.compute("")).toBeNull();
      expect(idx.compute("   ")).toBeNull();
    });

    it("digest length matches the configured truncateChars (default 32)", () => {
      const idx = new BlindIndex({ key: KEY });
      const digest = idx.compute("alice@example.com");
      expect(digest).toHaveLength(32);
      expect(digest).toMatch(/^[0-9a-f]+$/);
    });

    it("respects an explicit truncateChars override", () => {
      const idx = new BlindIndex({ key: KEY, truncateChars: 16 });
      const digest = idx.compute("alice@example.com");
      expect(digest).toHaveLength(16);
    });
  });

  describe("constructor validation", () => {
    it("rejects keys shorter than 32 bytes", () => {
      expect(() => new BlindIndex({ key: new Uint8Array(31) })).toThrow(/at least 32 bytes/);
    });

    it("rejects truncateChars outside [8, 64]", () => {
      expect(() => new BlindIndex({ key: KEY, truncateChars: 7 })).toThrow(/in \[8, 64\]/);
      expect(() => new BlindIndex({ key: KEY, truncateChars: 65 })).toThrow(/in \[8, 64\]/);
      expect(() => new BlindIndex({ key: KEY, truncateChars: 16.5 })).toThrow(/integer/);
    });
  });

  describe("computeMany()", () => {
    it("preserves input order + maps null entries to null", () => {
      const idx = new BlindIndex({ key: KEY });
      const out = idx.computeMany(["a@example.com", null, "b@example.com", undefined]);
      expect(out).toHaveLength(4);
      expect(out[0]).toBe(idx.compute("a@example.com"));
      expect(out[1]).toBeNull();
      expect(out[2]).toBe(idx.compute("b@example.com"));
      expect(out[3]).toBeNull();
    });
  });

  describe("planBlindIndexFromEnv()", () => {
    it("absent when env var is undefined / empty / whitespace", () => {
      expect(planBlindIndexFromEnv(undefined).kind).toBe("absent");
      expect(planBlindIndexFromEnv("").kind).toBe("absent");
      expect(planBlindIndexFromEnv("   ").kind).toBe("absent");
    });

    it("accepts a 32-byte hex key", () => {
      const hex = randomBytes(32).toString("hex");
      const plan = planBlindIndexFromEnv(hex);
      expect(plan.kind).toBe("accepted");
      if (plan.kind === "accepted") {
        expect(plan.key).toHaveLength(32);
      }
    });

    it("accepts a 32-byte base64 key", () => {
      const b64 = randomBytes(32).toString("base64");
      const plan = planBlindIndexFromEnv(b64);
      expect(plan.kind).toBe("accepted");
      if (plan.kind === "accepted") {
        expect(plan.key).toHaveLength(32);
      }
    });

    it("rejects too-short hex keys with a descriptive reason", () => {
      const hex = randomBytes(16).toString("hex"); // 16 bytes — too short
      const plan = planBlindIndexFromEnv(hex);
      expect(plan.kind).toBe("rejected");
      if (plan.kind === "rejected") {
        expect(plan.reason).toContain("at least 32 bytes");
      }
    });

    it("rejects too-short base64 keys with a descriptive reason", () => {
      const b64 = randomBytes(8).toString("base64"); // 8 bytes — too short
      const plan = planBlindIndexFromEnv(b64);
      expect(plan.kind).toBe("rejected");
      if (plan.kind === "rejected") {
        expect(plan.reason).toContain("at least 32 bytes");
      }
    });
  });

  describe("BLIND_INDEX DI token", () => {
    it("is a stable Symbol the EncryptionModule binds providers against", () => {
      expect(typeof BLIND_INDEX).toBe("symbol");
      expect(BLIND_INDEX.description).toContain("BlindIndex");
    });
  });
});
