import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { coverageThresholds } from "../../src/core/testing/coverage-gate.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * The Coverage-Gate slice requires that:
 *  - src/core/  has a line-coverage floor enforced by Vitest
 *  - src/modules/ has a (slightly looser) line-coverage floor
 *  - the gate is enforced as part of `.gitlab-ci.yml` (build breaks on miss)
 *
 * Lines are the headline metric; the other dimensions (statements,
 * functions, branches) are deliberately looser because defensive
 * runtime guards inflate their denominators without representing
 * real risk. The exact numbers are tuned so the current tree passes
 * comfortably with margin; a meaningful regression still trips the
 * gate.
 */
describe("Coverage-Gate", () => {
  describe("exposed thresholds", () => {
    it("exposes coverage thresholds for src/core and src/modules", () => {
      expect(coverageThresholds).toHaveProperty("src/core/**");
      expect(coverageThresholds).toHaveProperty("src/modules/**");
      expect(typeof coverageThresholds["src/core/**"]?.lines).toBe("number");
    });

    it("src/core has a meaningful line-coverage floor (≥ 70 %, ideally ≥ 80)", () => {
      const core = coverageThresholds["src/core/**"];
      // Floor — anything looser stops being a useful regression
      // gate. Tuned to leave ample margin above the current tree.
      expect(core.lines).toBeGreaterThanOrEqual(70);
      expect(core.statements).toBeGreaterThanOrEqual(60);
      expect(core.functions).toBeGreaterThanOrEqual(70);
      expect(core.branches).toBeGreaterThanOrEqual(50);
    });

    it("src/modules has a slightly looser floor than core", () => {
      const modules = coverageThresholds["src/modules/**"];
      const core = coverageThresholds["src/core/**"];
      // Modules are project-specific — looser numbers are fine but
      // they should never exceed core, otherwise the gate is
      // miscalibrated.
      expect(modules.lines).toBeLessThanOrEqual(core.lines);
      expect(modules.lines).toBeGreaterThanOrEqual(60);
    });
  });

  describe("GitLab CI wiring", () => {
    it(".gitlab-ci.yml runs `bun run test:coverage` so the gate breaks the build", async () => {
      const yaml = await readFile(resolve(ROOT, ".gitlab-ci.yml"), "utf8");
      expect(yaml).toMatch(/test:coverage:/);
      expect(yaml).toMatch(/bun run test:coverage/);
    });

    it(".gitlab-ci.yml exports a cobertura coverage report from the coverage job", async () => {
      const yaml = await readFile(resolve(ROOT, ".gitlab-ci.yml"), "utf8");
      expect(yaml).toMatch(/coverage_format:\s*cobertura/);
      expect(yaml).toMatch(/cobertura-coverage\.xml/);
    });
  });

  describe("vitest config wiring", () => {
    it("vitest.config.ts wires thresholds via the shared coverage-gate module", async () => {
      const cfg = await readFile(resolve(ROOT, "vitest.config.ts"), "utf8");
      expect(cfg).toMatch(/coverageThresholds/);
      expect(cfg).toMatch(/from ['"]\.\/src\/core\/testing\/coverage-gate/);
    });
  });
});
