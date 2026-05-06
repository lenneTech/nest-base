import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · Dev-tooling script integrity (SC.DX.03 + SC.PERF.07).
 *
 * The PRD's `SC.DX.03` requires `bun run docs:screenshots` to
 * reproduce every dev-portal page. A live screenshot run depends on
 * Playwright + a running server + a deterministic environment, so it
 * isn't feasible inside the unit test runner. What this slice does
 * enforce is the structural part: the script exists, is wired to its
 * `package.json` entry, and uses the Playwright pattern that produces
 * the screenshot directory layout the showcase docs reference.
 *
 * Same shape for `SC.PERF.07`: `bun run llm-test` is a long-running
 * autonomous test loop. We can't run it inside vitest, but we can
 * lock the script's structural invariants so a developer renaming /
 * deleting the entry point fails CI immediately.
 */
const ROOT = resolve(__dirname, "..", "..");

interface PackageJson {
  scripts: Record<string, string>;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as PackageJson;
}

describe("Story · Dev-tooling script integrity", () => {
  describe("SC.DX.03 — docs:screenshots script", () => {
    it("scripts/take-showcase-screenshots.ts exists", () => {
      expect(existsSync(join(ROOT, "scripts/take-showcase-screenshots.ts"))).toBe(true);
    });

    it("package.json wires `docs:screenshots` to the script", () => {
      const pkg = readPackageJson();
      expect(pkg.scripts["docs:screenshots"]).toBeDefined();
      expect(pkg.scripts["docs:screenshots"]).toContain("take-showcase-screenshots");
    });

    it("the showcase docs directory anchors the screenshot output", () => {
      // The docs/showcase/ directory is the consumer of every shot —
      // it has to exist for the screenshot script to write into it.
      expect(existsSync(join(ROOT, "docs/showcase"))).toBe(true);
    });

    it("the script body references both desktop + mobile baselines (1440 / 390)", () => {
      const body = readFileSync(join(ROOT, "scripts/take-showcase-screenshots.ts"), "utf8");
      expect(body).toMatch(/1440/);
      expect(body).toMatch(/390/);
    });
  });

  describe("SC.PERF.07 — llm-test script", () => {
    it("scripts/llm-feature-test.ts exists", () => {
      expect(existsSync(join(ROOT, "scripts/llm-feature-test.ts"))).toBe(true);
    });

    it("package.json wires `llm-test` to the script", () => {
      const pkg = readPackageJson();
      expect(pkg.scripts["llm-test"]).toBeDefined();
      expect(pkg.scripts["llm-test"]).toContain("llm-feature-test");
    });

    it("the script entry-point is non-empty TypeScript", () => {
      const body = readFileSync(join(ROOT, "scripts/llm-feature-test.ts"), "utf8");
      expect(body.length).toBeGreaterThan(0);
    });
  });
});
