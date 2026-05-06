import { describe, expect, it } from "vitest";

/**
 * Story · Hub password lifecycle (pure planner assertions).
 *
 * Validates the first-boot / subsequent-boot password generation
 * logic without hitting Postgres. The password is generated once,
 * argon2-hashed, stored in `system_secrets`; subsequent boots only
 * read the hash and never log the plaintext.
 *
 * Rules from issue #83:
 *   - First boot in non-local: generate 24-char base32 random password,
 *     argon2-hash it, store hash in `system_secrets`, log plaintext ONCE.
 *   - Subsequent boots: only read hash, never log.
 *   - `hub:reset-password` CLI: generates new password, prints once,
 *     replaces hash.
 */

import { buildHubPasswordPlan } from "../../src/core/hub/hub-password-planner.js";

describe("Story · Hub password planner", () => {
  describe("buildHubPasswordPlan", () => {
    it("plans generate+log on first boot (no existing hash)", () => {
      const plan = buildHubPasswordPlan({ existingHash: null, stage: "production" });
      expect(plan.action).toBe("generate");
      expect(plan.logPlaintext).toBe(true);
    });

    it("plans read-only on subsequent boot (hash exists)", () => {
      const plan = buildHubPasswordPlan({ existingHash: "$argon2id$...", stage: "production" });
      expect(plan.action).toBe("verify-only");
      expect(plan.logPlaintext).toBe(false);
    });

    it("plans nothing for local stage regardless of hash presence", () => {
      const withHash = buildHubPasswordPlan({ existingHash: "$argon2id$...", stage: "local" });
      const noHash = buildHubPasswordPlan({ existingHash: null, stage: "local" });
      expect(withHash.action).toBe("skip");
      expect(noHash.action).toBe("skip");
    });

    it("generated password hint length is 24 chars (base32 alphabet)", () => {
      const plan = buildHubPasswordPlan({ existingHash: null, stage: "staging" });
      expect(plan.action).toBe("generate");
      if (plan.action === "generate") {
        expect(plan.passwordLength).toBe(24);
        expect(plan.alphabet).toBe("base32");
      }
    });

    it("logPlaintext is false in generate plan for local stage (skip wins)", () => {
      const plan = buildHubPasswordPlan({ existingHash: null, stage: "local" });
      expect(plan.logPlaintext).toBe(false);
    });

    it("reset plan always plans generate+log regardless of existing hash", () => {
      const plan = buildHubPasswordPlan({
        existingHash: "$argon2id$...",
        stage: "production",
        resetMode: true,
      });
      expect(plan.action).toBe("generate");
      expect(plan.logPlaintext).toBe(true);
    });
  });
});
