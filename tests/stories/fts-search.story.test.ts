import { describe, expect, it } from "vitest";

import { sanitizeFtsQuery, toTsquery } from "../../src/core/search/fts-query.js";

/**
 * Story · FTS-Search Edge Cases (PLAN.md §11 + §28.4/#17).
 *
 * Postgres `to_tsquery` rejects malformed input; user-supplied search
 * strings need normalization before they hit the DB. The helpers
 * here cover the edge cases that production traffic hits:
 *   - special operators stripped
 *   - whitespace collapsed
 *   - `& | !` symbols neutralized
 *   - trailing prefix-search support (`foo:*`)
 *   - empty input rejected
 */
describe("Story · FTS query sanitization", () => {
  describe("sanitizeFtsQuery()", () => {
    it("returns the input unchanged when it is alphanumeric + spaces", () => {
      expect(sanitizeFtsQuery("hello world")).toBe("hello world");
    });

    it("strips the `&`, `|`, `!`, `:`, `*`, `(`, `)` operators", () => {
      expect(sanitizeFtsQuery("a & b | c ! d")).toBe("a b c d");
      expect(sanitizeFtsQuery("foo:*")).toBe("foo");
      expect(sanitizeFtsQuery("(test)")).toBe("test");
    });

    it("collapses repeated whitespace", () => {
      expect(sanitizeFtsQuery("   hello   world   ")).toBe("hello world");
    });

    it("rejects empty / whitespace-only input", () => {
      expect(() => sanitizeFtsQuery("")).toThrow();
      expect(() => sanitizeFtsQuery("   ")).toThrow();
      expect(() => sanitizeFtsQuery("&|!")).toThrow();
    });

    it("keeps unicode word characters intact", () => {
      expect(sanitizeFtsQuery("café münchen")).toBe("café münchen");
    });
  });

  describe("toTsquery()", () => {
    it("joins tokens with `&` for AND-search", () => {
      expect(toTsquery("hello world")).toBe("hello & world");
    });

    it("appends `:*` to enable prefix-search on the last token (typeahead)", () => {
      expect(toTsquery("hello world", { prefix: true })).toBe("hello & world:*");
    });

    it("runs the input through sanitizeFtsQuery first", () => {
      expect(toTsquery("a & b | c")).toBe("a & b & c");
    });

    it("a single-token query returns just the token (with `:*` if prefix)", () => {
      expect(toTsquery("hello")).toBe("hello");
      expect(toTsquery("hello", { prefix: true })).toBe("hello:*");
    });

    it("rejects empty input", () => {
      expect(() => toTsquery("")).toThrow();
    });
  });
});
