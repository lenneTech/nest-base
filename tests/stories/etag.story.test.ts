import { describe, expect, it } from "vitest";

import {
  ETagMissingError,
  ETagPreconditionFailedError,
  computeETag,
  parseIfMatch,
  verifyIfMatch,
} from "../../src/core/concurrency/etag.js";

/**
 * Story · ETag / If-Match optimistic concurrency
 * (PLAN.md §32 Phase 8).
 *
 * GET responses carry a strong ETag derived from the resource's
 * `version` + `updatedAt`. Mutating endpoints require the client to
 * send the most-recent ETag back as `If-Match`; the pipe matches and
 * either lets the request through or raises 412.
 *
 * The pipe stays pure here — the controller / NestJS adapter calls
 * verifyIfMatch() with the loaded record's ETag and the request
 * header, then dispatches the right HTTP status from the thrown
 * sentinel.
 */
describe("Story · ETag / If-Match", () => {
  describe("computeETag()", () => {
    it("returns a quoted strong ETag (RFC 7232 §2.3)", () => {
      const tag = computeETag({ version: 1, updatedAt: "2026-04-28T12:00:00Z" });
      expect(tag).toMatch(/^"[^"]+"$/);
    });

    it("is deterministic for the same inputs", () => {
      const a = computeETag({ version: 7, updatedAt: "2026-04-28T12:00:00Z" });
      const b = computeETag({ version: 7, updatedAt: "2026-04-28T12:00:00Z" });
      expect(a).toBe(b);
    });

    it("changes when the version changes", () => {
      const a = computeETag({ version: 1, updatedAt: "2026-04-28T12:00:00Z" });
      const b = computeETag({ version: 2, updatedAt: "2026-04-28T12:00:00Z" });
      expect(a).not.toBe(b);
    });

    it("changes when the updatedAt changes", () => {
      const a = computeETag({ version: 1, updatedAt: "2026-04-28T12:00:00Z" });
      const b = computeETag({ version: 1, updatedAt: "2026-04-28T13:00:00Z" });
      expect(a).not.toBe(b);
    });

    it("embeds the version into the tag for human-readable debugging", () => {
      const tag = computeETag({ version: 42, updatedAt: "2026-04-28T12:00:00Z" });
      expect(tag).toContain("v42");
    });
  });

  describe("parseIfMatch()", () => {
    it("returns the raw string for a single quoted tag", () => {
      expect(parseIfMatch('"v3-abc"')).toEqual(['"v3-abc"']);
    });

    it("splits a comma-separated list", () => {
      expect(parseIfMatch('"v3-abc", "v3-xyz"')).toEqual(['"v3-abc"', '"v3-xyz"']);
    });

    it("handles whitespace around commas", () => {
      expect(parseIfMatch('"v3-abc"  ,   "v3-xyz"')).toEqual(['"v3-abc"', '"v3-xyz"']);
    });

    it("returns the wildcard token verbatim", () => {
      expect(parseIfMatch("*")).toEqual(["*"]);
    });

    it("returns an empty array for empty / undefined input", () => {
      expect(parseIfMatch("")).toEqual([]);
      expect(parseIfMatch(undefined)).toEqual([]);
    });
  });

  describe("verifyIfMatch()", () => {
    const currentETag = '"v3-abcdef"';

    it("passes when the If-Match header matches the current ETag", () => {
      expect(() => verifyIfMatch(currentETag, '"v3-abcdef"')).not.toThrow();
    });

    it("passes when one of multiple If-Match values matches", () => {
      expect(() => verifyIfMatch(currentETag, '"v2-old", "v3-abcdef"')).not.toThrow();
    });

    it('passes on the wildcard "*" (RFC 7232 — accept any existing entity)', () => {
      expect(() => verifyIfMatch(currentETag, "*")).not.toThrow();
    });

    it("throws ETagMissingError when the header is absent (mutations require it)", () => {
      expect(() => verifyIfMatch(currentETag, undefined)).toThrow(ETagMissingError);
    });

    it("throws ETagMissingError on an empty header", () => {
      expect(() => verifyIfMatch(currentETag, "")).toThrow(ETagMissingError);
    });

    it("throws ETagPreconditionFailedError when none of the values match", () => {
      expect(() => verifyIfMatch(currentETag, '"v1-old", "v2-older"')).toThrow(
        ETagPreconditionFailedError,
      );
    });

    it("matches strong ETags strictly (W/-prefixed weak tags must not pass)", () => {
      expect(() => verifyIfMatch(currentETag, 'W/"v3-abcdef"')).toThrow(
        ETagPreconditionFailedError,
      );
    });

    it("preserves the current ETag on the precondition error so the controller can echo it", () => {
      try {
        verifyIfMatch(currentETag, '"v1-old"');
        throw new Error("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(ETagPreconditionFailedError);
        expect((e as ETagPreconditionFailedError).currentETag).toBe(currentETag);
      }
    });
  });
});
