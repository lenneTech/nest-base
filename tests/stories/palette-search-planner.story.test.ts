/**
 * Story · palette-search-planner (Issue #90 — Cmd+K command palette)
 *
 * The planner is a pure function: given a list of registered Hub pages
 * and a freeform query, it returns a ranked, capped list of matching
 * pages. No I/O, no side-effects — fully testable in isolation.
 *
 * Ranking (highest → lowest):
 *   exact   — query === title (case-insensitive)
 *   prefix  — title starts with query
 *   substring — title contains query
 *   fuzzy   — Levenshtein distance ≤ 1 on any word
 */
import { describe, expect, it } from "vitest";

import {
  searchPalettePages,
  type PalettePageEntry,
} from "../../src/core/dx/palette-search-planner.js";

const PAGES: readonly PalettePageEntry[] = [
  { id: "dev-hub", title: "Dev Hub", href: "/hub", aliases: [], category: "Übersicht" },
  {
    id: "logs",
    title: "Logs",
    href: "/hub/logs",
    aliases: ["Protokolle", "logging"],
    category: "Übersicht",
  },
  {
    id: "migrations",
    title: "Migrations",
    href: "/hub/migrations",
    aliases: ["schema", "migrate"],
    category: "Übersicht",
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    href: "/hub/diagnostics",
    aliases: ["health", "memory"],
    category: "Übersicht",
  },
  {
    id: "features",
    title: "Features",
    href: "/hub/features",
    aliases: ["flags", "toggles"],
    category: "Übersicht",
  },
  {
    id: "routes",
    title: "Routes",
    href: "/hub/routes",
    aliases: ["endpoints"],
    category: "API & Docs",
  },
  { id: "errors", title: "Error Codes", href: "/errors", aliases: [], category: "API & Docs" },
  {
    id: "erd",
    title: "ERD",
    href: "/hub/erd",
    aliases: ["entity-relation", "schema"],
    category: "API & Docs",
  },
  { id: "sessions", title: "Sessions", href: "/admin/sessions", aliases: [], category: "Admin" },
  {
    id: "permissions",
    title: "Permission Tester",
    href: "/admin/permissions/test",
    aliases: ["casl"],
    category: "Admin",
  },
];

describe("Story · searchPalettePages (palette-search-planner)", () => {
  // -------------------------------------------------------------------
  // Empty query
  // -------------------------------------------------------------------
  describe("empty query", () => {
    it("returns all pages sorted by title", () => {
      const result = searchPalettePages({ query: "", pages: PAGES });
      expect(result).toHaveLength(PAGES.length);

      // Must be title-sorted
      const titles = result.map((r) => r.title);
      expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
    });

    it("includes every page id", () => {
      const result = searchPalettePages({ query: "", pages: PAGES });
      const ids = new Set(result.map((r) => r.id));
      for (const page of PAGES) {
        expect(ids.has(page.id)).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------
  // Exact match
  // -------------------------------------------------------------------
  describe("exact match", () => {
    it("promotes the exact-match page to the front with matchType 'exact'", () => {
      const result = searchPalettePages({ query: "Logs", pages: PAGES });
      expect(result[0]?.id).toBe("logs");
      expect(result[0]?.matchType).toBe("exact");
    });

    it("is case-insensitive", () => {
      const lower = searchPalettePages({ query: "logs", pages: PAGES });
      const upper = searchPalettePages({ query: "LOGS", pages: PAGES });
      expect(lower[0]?.id).toBe("logs");
      expect(upper[0]?.id).toBe("logs");
    });

    it("exact match has a higher score than any other result", () => {
      const result = searchPalettePages({ query: "Logs", pages: PAGES });
      const exactScore = result[0]!.score;
      for (const r of result.slice(1)) {
        expect(exactScore).toBeGreaterThan(r.score);
      }
    });
  });

  // -------------------------------------------------------------------
  // Prefix match
  // -------------------------------------------------------------------
  describe("prefix match", () => {
    it("returns a prefix result with matchType 'prefix'", () => {
      const result = searchPalettePages({ query: "Migr", pages: PAGES });
      const migrations = result.find((r) => r.id === "migrations");
      expect(migrations).toBeDefined();
      expect(migrations?.matchType).toBe("prefix");
    });

    it("prefix beats substring in score", () => {
      // "Error" is a prefix of "Error Codes"; "routes" contains no prefix
      // but is separate. Use a scenario where we can compare.
      // "Dia" is a prefix of "Diagnostics", which also contains substring "ia"
      const result = searchPalettePages({ query: "Dia", pages: PAGES });
      const diag = result.find((r) => r.id === "diagnostics");
      expect(diag?.matchType).toBe("prefix");

      // No substring-only match should outrank the prefix match
      const prefixScore = diag?.score ?? 0;
      for (const r of result) {
        if (r.matchType === "substring") {
          expect(prefixScore).toBeGreaterThanOrEqual(r.score);
        }
      }
    });
  });

  // -------------------------------------------------------------------
  // Substring match
  // -------------------------------------------------------------------
  describe("substring match", () => {
    it("finds pages whose title contains the query", () => {
      const result = searchPalettePages({ query: "Codes", pages: PAGES });
      const errorCodes = result.find((r) => r.id === "errors");
      expect(errorCodes).toBeDefined();
      expect(errorCodes?.matchType).toBe("substring");
    });

    it("alias substring also matches", () => {
      // "Protokolle" is an alias of the logs page
      const result = searchPalettePages({ query: "Protokolle", pages: PAGES });
      const logs = result.find((r) => r.id === "logs");
      expect(logs).toBeDefined();
    });
  });

  // -------------------------------------------------------------------
  // Fuzzy match (Levenshtein ≤ 1)
  // -------------------------------------------------------------------
  describe("fuzzy match (distance ≤ 1)", () => {
    it("matches a one-character typo in the title", () => {
      // "Lgos" → "Logs" (1 substitution)
      const result = searchPalettePages({ query: "Lgos", pages: PAGES });
      const logs = result.find((r) => r.id === "logs");
      expect(logs).toBeDefined();
      expect(logs?.matchType).toBe("fuzzy");
    });

    it("fuzzy score is lower than exact, prefix, and substring", () => {
      // "Featurrs" → "Features" (1 substitution)
      const result = searchPalettePages({ query: "Featurrs", pages: PAGES });
      const fuzzy = result.find((r) => r.matchType === "fuzzy");
      const exact = result.find((r) => r.matchType === "exact");
      const prefix = result.find((r) => r.matchType === "prefix");
      const substring = result.find((r) => r.matchType === "substring");

      if (fuzzy && exact) expect(fuzzy.score).toBeLessThan(exact.score);
      if (fuzzy && prefix) expect(fuzzy.score).toBeLessThan(prefix.score);
      if (fuzzy && substring) expect(fuzzy.score).toBeLessThan(substring.score);
    });

    it("does NOT match a two-character typo", () => {
      // "Lgse" is 2 edits away from "Logs"
      const result = searchPalettePages({ query: "Lgse", pages: PAGES });
      const logs = result.find((r) => r.id === "logs");
      // Either not present or score should be 0 / matchType undefined
      if (logs) {
        expect(logs.score).toBe(0);
      }
    });
  });

  // -------------------------------------------------------------------
  // maxResults cap
  // -------------------------------------------------------------------
  describe("maxResults", () => {
    it("caps output at maxResults", () => {
      const result = searchPalettePages({ query: "", pages: PAGES, maxResults: 3 });
      expect(result).toHaveLength(3);
    });

    it("defaults to 30 (or all pages if fewer)", () => {
      const result = searchPalettePages({ query: "", pages: PAGES });
      expect(result.length).toBeLessThanOrEqual(30);
      expect(result.length).toBe(PAGES.length); // PAGES has 10 entries
    });
  });

  // -------------------------------------------------------------------
  // Result shape
  // -------------------------------------------------------------------
  describe("result shape", () => {
    it("every result includes id, title, href, score, matchType, category", () => {
      const result = searchPalettePages({ query: "log", pages: PAGES });
      for (const r of result) {
        expect(typeof r.id).toBe("string");
        expect(typeof r.title).toBe("string");
        expect(typeof r.href).toBe("string");
        expect(typeof r.score).toBe("number");
        expect(["exact", "prefix", "substring", "fuzzy"]).toContain(r.matchType);
        expect(typeof r.category).toBe("string");
      }
    });

    it("results are sorted by score descending", () => {
      const result = searchPalettePages({ query: "log", pages: PAGES });
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1]!.score).toBeGreaterThanOrEqual(result[i]!.score);
      }
    });
  });
});
