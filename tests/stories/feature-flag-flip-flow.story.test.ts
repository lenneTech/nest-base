import { describe, expect, it } from "vitest";

import { planEnvFileUpdate } from "../../src/core/dx/env-file-update.js";

/**
 * Story · Feature-flag flip flow (SC.BOOT.05).
 *
 * The PRD's `SC.BOOT.05` requires that flipping a feature OFF in the
 * `/hub/features` UI:
 *   1. Patches the `.env` file (existing line replaced; missing line
 *      appended).
 *   2. Triggers the dev runner's watch loop to restart the server
 *      with the new feature set.
 *   3. The route audit at `/hub/routes.json` reflects the dropped
 *      feature within 5s of the flip.
 *
 * The dev session runner (CF.DH.46 — env watcher) handles steps 2-3
 * by spawning a fresh server process when `.env` changes. This slice
 * locks the planner contract for step 1: the `.env` patch must be
 * deterministic, idempotent, and never destroy adjacent comments
 * or blank lines.
 */
describe("Story · Feature-flag flip flow (SC.BOOT.05)", () => {
  describe("planEnvFileUpdate — patch contract", () => {
    it("replaces an existing line in place, preserving order", () => {
      const current = "OTHER=stay\nFEATURE_WEBHOOKS_ENABLED=true\nLAST=line\n";
      const plan = planEnvFileUpdate({
        current,
        key: "FEATURE_WEBHOOKS_ENABLED",
        value: "false",
      });
      expect(plan.action).toBe("replaced");
      expect(plan.next).toMatch(/^OTHER=stay\n/);
      expect(plan.next).toMatch(/FEATURE_WEBHOOKS_ENABLED=false\n/);
      expect(plan.next).toMatch(/LAST=line\n$/);
    });

    it("appends a new line when the key is absent", () => {
      const current = "OTHER=stay\n";
      const plan = planEnvFileUpdate({
        current,
        key: "FEATURE_REALTIME_ENABLED",
        value: "true",
      });
      expect(plan.action).toBe("appended");
      expect(plan.next).toContain("FEATURE_REALTIME_ENABLED=true");
    });

    it("handles a blank file by writing a single line", () => {
      const plan = planEnvFileUpdate({
        current: "",
        key: "FEATURE_MULTI_TENANCY_ENABLED",
        value: "true",
      });
      expect(plan.action).toBe("appended");
      expect(plan.next).toContain("FEATURE_MULTI_TENANCY_ENABLED=true");
    });

    it("rejects keys containing lowercase or special chars", () => {
      expect(() =>
        planEnvFileUpdate({
          current: "",
          key: "feature_lowercase",
          value: "true",
        }),
      ).toThrow(/invalid key/);
    });

    it("rejects values containing newlines (would break .env semantics)", () => {
      expect(() =>
        planEnvFileUpdate({
          current: "",
          key: "FEATURE_X",
          value: "line1\nline2",
        }),
      ).toThrow(/newline/);
    });

    it("preserves adjacent comments + blank lines around the patched key", () => {
      const current =
        "# Comment above\n" +
        "BEFORE=keep\n" +
        "\n" +
        "FEATURE_GEO_ENABLED=true # inline note\n" +
        "\n" +
        "AFTER=keep\n";
      const plan = planEnvFileUpdate({
        current,
        key: "FEATURE_GEO_ENABLED",
        value: "false",
      });
      expect(plan.action).toBe("replaced");
      expect(plan.next).toContain("# Comment above");
      expect(plan.next).toContain("BEFORE=keep");
      expect(plan.next).toContain("AFTER=keep");
      expect(plan.next).toMatch(/FEATURE_GEO_ENABLED=false/);
    });
  });

  describe("end-to-end UX simulation", () => {
    it("flipping a feature OFF then ON converges back to the original payload", () => {
      const initial = "FEATURE_WEBHOOKS_ENABLED=true\n";
      const off = planEnvFileUpdate({
        current: initial,
        key: "FEATURE_WEBHOOKS_ENABLED",
        value: "false",
      });
      const on = planEnvFileUpdate({
        current: off.next,
        key: "FEATURE_WEBHOOKS_ENABLED",
        value: "true",
      });
      // Round-tripping returns to the same payload (line in place, value true)
      expect(on.next).toBe(initial);
    });

    it("repeated flips reuse the same line — no .env file growth", () => {
      let state = "FEATURE_X_ENABLED=false\n";
      for (let i = 0; i < 10; i++) {
        state = planEnvFileUpdate({
          current: state,
          key: "FEATURE_X_ENABLED",
          value: i % 2 === 0 ? "true" : "false",
        }).next;
      }
      // After 10 flips, the file should still have exactly 1 line.
      const lines = state.split("\n").filter((l) => l !== "");
      expect(lines).toHaveLength(1);
    });
  });
});
