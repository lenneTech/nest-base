import { describe, expect, it } from "vitest";

import { buildAbility } from "../../src/core/permissions/casl-ability.js";
import { OutputPipeline } from "../../src/core/output-pipeline/output-pipeline.js";

/**
 * Story · Output-Pipeline (4 stages — see docs/architecture.md "Output pipeline").
 *
 *   Stage 1 — Permission filter (record-level): the controller hands
 *             the pipeline an already-filtered list (the `accessibleBy()`
 *             query happens at the DB layer). Stage 1 is a pass-through
 *             at the response shape; the caller-side check is the
 *             record-level filter.
 *   Stage 2 — Field-level allowlist (Ability.fields)
 *   Stage 3 — Strip known secret keys
 *   Stage 4 — Safety-net regression catcher
 *
 * The interceptor walks objects + arrays and applies the four stages
 * in order. Each stage is composable in isolation (existing
 * `remove-secrets` / `safety-net` modules) and the pipeline glues them.
 */
describe("Story · Output-Pipeline (4-Stage)", () => {
  describe("Stage 2 · Field allowlist", () => {
    it("keeps only the fields the ability allows for a given subject", () => {
      const ability = buildAbility([{ action: "read", subject: "User", fields: ["id", "email"] }]);
      const pipeline = new OutputPipeline({ ability });
      const out = pipeline.run(
        { id: "1", email: "a@x.com", passwordHash: "h" },
        { subject: "User" },
      );
      expect(out).toEqual({ id: "1", email: "a@x.com" });
    });

    it("returns the value untouched when the ability has no field rule for that subject", () => {
      const ability = buildAbility([{ action: "read", subject: "Project" }]);
      const pipeline = new OutputPipeline({ ability });
      const out = pipeline.run({ id: "1", name: "p" }, { subject: "Project" });
      expect(out).toEqual({ id: "1", name: "p" });
    });

    it("is applied per-item over arrays", () => {
      const ability = buildAbility([{ action: "read", subject: "User", fields: ["id"] }]);
      const pipeline = new OutputPipeline({ ability });
      const out = pipeline.run(
        [
          { id: "1", email: "a@x.com" },
          { id: "2", email: "b@x.com" },
        ],
        { subject: "User" },
      );
      expect(out).toEqual([{ id: "1" }, { id: "2" }]);
    });
  });

  describe("Stage 3 · removeSecrets", () => {
    it("strips top-level secret-named fields after the field allowlist runs", () => {
      const ability = buildAbility([{ action: "read", subject: "User" }]);
      const pipeline = new OutputPipeline({ ability });
      const out = pipeline.run({ id: "1", token: "t" }, { subject: "User" });
      expect(out).toEqual({ id: "1" });
    });
  });

  describe("Stage 4 · Safety-net", () => {
    it("throws SafetyNetViolationError when an unknown secret-shaped key survives Stage 3", () => {
      // Custom secret list at the safety-net so this test case can craft a
      // path where Stage 3 does NOT know about the field but Stage 4 does.
      const ability = buildAbility([{ action: "read", subject: "User" }]);
      const pipeline = new OutputPipeline({
        ability,
        safetyNetMode: "throw",
        safetyNetExtraFields: ["surprisePin"],
      });
      expect(() => pipeline.run({ id: "1", surprisePin: "p" }, { subject: "User" })).toThrow(
        /surprisePin/,
      );
    });

    it("mask mode redacts instead of throwing", () => {
      const ability = buildAbility([{ action: "read", subject: "User" }]);
      const pipeline = new OutputPipeline({
        ability,
        safetyNetMode: "mask",
        safetyNetExtraFields: ["surprisePin"],
      });
      const out = pipeline.run({ id: "1", surprisePin: "p" }, { subject: "User" });
      expect(out).toEqual({ id: "1", surprisePin: "[redacted]" });
    });
  });

  describe("Order of stages", () => {
    it("field allowlist runs BEFORE secret strip (so an allowed `token` field is dropped by Stage 3)", () => {
      const ability = buildAbility([{ action: "read", subject: "User", fields: ["id", "token"] }]);
      const pipeline = new OutputPipeline({ ability });
      const out = pipeline.run({ id: "1", token: "t", email: "a@x.com" }, { subject: "User" });
      // Stage 2 keeps id+token (allowed), Stage 3 strips token (secret name).
      expect(out).toEqual({ id: "1" });
    });
  });

  describe("MAJ-2 · deny-rule (inverted) must NOT contribute fields to the allow-union", () => {
    it("cannot('read', 'User', ['ssn']) does NOT add ssn to the allowed-field set", () => {
      // Build an ability with a deny-rule for 'ssn'. The deny-rule is inverted.
      // Prior to the fix, rule.fields was unioned unconditionally, so 'ssn' would
      // appear in the allow-list and be returned.
      const ability = buildAbility([
        { action: "read", subject: "User", fields: ["id", "email"] },
        { action: "read", subject: "User", fields: ["ssn"], inverted: true },
      ]);
      const pipeline = new OutputPipeline({ ability });
      const out = pipeline.run(
        { id: "1", email: "a@x.com", ssn: "123-45-6789" },
        { subject: "User" },
      );
      // ssn must NOT appear — the deny-rule should not cause it to be included.
      expect(out).not.toHaveProperty("ssn");
      expect(out).toEqual({ id: "1", email: "a@x.com" });
    });

    it("a subject with only inverted rules returns null allowlist (no field restriction)", () => {
      // When only deny-rules exist, the allow-union is empty and the pipeline
      // returns null (no field restriction — the subject is fully readable,
      // guarded only by Stage 3 secrets strip).
      const ability = buildAbility([
        { action: "read", subject: "User" },
        { action: "read", subject: "User", fields: ["ssn"], inverted: true },
      ]);
      const pipeline = new OutputPipeline({ ability });
      // The can("read", "User") without fields means "all fields allowed".
      // The inverted rule must not subtract from that.
      const out = pipeline.run({ id: "1", email: "a@x.com" }, { subject: "User" });
      expect(out).toEqual({ id: "1", email: "a@x.com" });
    });
  });
});
