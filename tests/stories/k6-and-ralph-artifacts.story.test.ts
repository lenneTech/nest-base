import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · k6 + .ralph artifacts (TR.Testing — k6, DX & AI Tooling —
 * .ralph autonomous-loop config; iter-96 review Findings 15 + 16).
 *
 * The PRD pins:
 *   - "k6 (tests/k6/*.js)" under TR.Testing — the team uses k6 to
 *     back the SC.PERF.* budgets with sustained-load probes.
 *   - ".ralph/ autonomous-loop config + ralph-import workflow" under
 *     DX & AI Tooling — the loop control surface that drives the
 *     iteration plugin.
 *
 * Iter-103 ships both. The story test pins each artifact's presence
 * + the structural shape that the loop runtime + k6 binary expect.
 */
const ROOT = resolve(__dirname, "..", "..");

describe("Story · k6 + .ralph artifacts", () => {
  describe("tests/k6/*.js", () => {
    it("ships at least one k6 script besides the .gitkeep", () => {
      const dir = resolve(ROOT, "tests/k6");
      expect(existsSync(dir)).toBe(true);
      const { readdirSync } = require("node:fs") as typeof import("node:fs");
      const entries = readdirSync(dir).filter((f) => f.endsWith(".js") && !f.startsWith("."));
      expect(entries.length).toBeGreaterThan(0);
    });

    it("health-live-rps.js declares thresholds for SC.PERF.02 budgets", () => {
      const path = resolve(ROOT, "tests/k6/health-live-rps.js");
      expect(existsSync(path)).toBe(true);
      const src = readFileSync(path, "utf8");
      expect(src).toContain("/health/live");
      // Threshold strings encode median + p95 + failure budgets.
      expect(src).toMatch(/med\s*<\s*50/);
      expect(src).toMatch(/p\(95\)\s*<\s*200/);
      expect(src).toContain("http_req_failed");
    });

    it("cold-start-latency.js declares the SC.PERF.01 5s budget", () => {
      const path = resolve(ROOT, "tests/k6/cold-start-latency.js");
      expect(existsSync(path)).toBe(true);
      const src = readFileSync(path, "utf8");
      expect(src).toContain("p(95)<5000");
      expect(src).toContain("/health/live");
    });
  });

  describe(".ralph/", () => {
    it("ships a config.json with the canonical loop knobs", () => {
      const path = resolve(ROOT, ".ralph/config.json");
      expect(existsSync(path)).toBe(true);
      const config = JSON.parse(readFileSync(path, "utf8"));
      expect(config.version).toBe(1);
      expect(config.loop?.completionPromise).toBe("ImplementedEverything");
      expect(config.loop?.specPath).toBe("nest-base-prd.md");
      expect(config.loop?.checklistPath).toBe("SPEC-CHECKLIST.md");
      expect(config.loop?.verifyScript).toBe("scripts/verify-spec.sh");
      expect(Array.isArray(config.loop?.qualityGates)).toBe(true);
      expect(config.loop.qualityGates.length).toBeGreaterThanOrEqual(5);
    });

    it("declares disqualifier patterns matching the PRD list", () => {
      const path = resolve(ROOT, ".ralph/config.json");
      const config = JSON.parse(readFileSync(path, "utf8"));
      const patterns = config.loop?.disqualifierPatterns ?? [];
      expect(patterns).toContain("TODO");
      expect(patterns).toContain("FIXME");
      expect(patterns).toContain("placeholder");
      expect(patterns).toContain("NotImplemented");
      expect(patterns).toContain("as any");
    });

    it("ships a README that documents the import workflow", () => {
      const path = resolve(ROOT, ".ralph/README.md");
      expect(existsSync(path)).toBe(true);
      const readme = readFileSync(path, "utf8");
      expect(readme).toContain("ralph-import");
      expect(readme).toContain("SPEC-CHECKLIST.md");
      expect(readme).toContain("scripts/verify-spec.sh");
    });
  });
});
