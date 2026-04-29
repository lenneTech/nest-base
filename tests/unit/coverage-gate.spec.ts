import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { coverageThresholds } from "../../src/core/testing/coverage-gate.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * The Coverage-Gate slice (PLAN.md §32 Phase 1) requires that:
 *  - src/core/  ≥ 90 % line coverage
 *  - src/modules/ ≥ 80 % line coverage
 *  - the gate is enforced as part of `.gitlab-ci.yml` (build breaks on miss)
 *
 * The actual threshold check is handled by Vitest. This spec only verifies
 * that the configured thresholds exist, are at the documented levels, and
 * that GitLab CI runs the coverage job so a regression breaks the pipeline.
 */
describe("Coverage-Gate", () => {
  describe("exposed thresholds", () => {
    it("exposes coverage thresholds for src/core and src/modules", () => {
      expect(coverageThresholds).toMatchObject({
        "src/core/**": { lines: 90 },
        "src/modules/**": { lines: 80 },
      });
    });

    it("src/core threshold is at least 90 % across all coverage axes", () => {
      const core = coverageThresholds["src/core/**"];
      expect(core.lines).toBeGreaterThanOrEqual(90);
      expect(core.statements).toBeGreaterThanOrEqual(90);
      expect(core.functions).toBeGreaterThanOrEqual(90);
      expect(core.branches).toBeGreaterThanOrEqual(85);
    });

    it("src/modules threshold is at least 80 % across all coverage axes", () => {
      const modules = coverageThresholds["src/modules/**"];
      expect(modules.lines).toBeGreaterThanOrEqual(80);
      expect(modules.statements).toBeGreaterThanOrEqual(80);
      expect(modules.functions).toBeGreaterThanOrEqual(80);
      expect(modules.branches).toBeGreaterThanOrEqual(75);
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
