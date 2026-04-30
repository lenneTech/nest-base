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
});
