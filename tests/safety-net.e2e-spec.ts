import { describe, expect, it } from "vitest";

import { applySafetyNet, SafetyNetViolationError } from "../src/core/output-pipeline/safety-net.js";

/**
 * Adapted from nest-server `safety-net.e2e-spec.ts`.
 *
 * Stage 4 of the Output-Pipeline. Catches the regression where an
 * earlier stage forgot to strip a secret-named field — the safety net
 * either masks the value or throws, depending on configuration.
 */
describe("Output-Pipeline · Safety-Net (mode-driven)", () => {
  describe("mode=mask", () => {
    it("replaces secret values with `[redacted]` recursively", () => {
      const out = applySafetyNet(
        { user: { password: "p", token: "t", email: "a@x.com" } },
        { mode: "mask" },
      );
      expect(out).toEqual({
        user: { password: "[redacted]", token: "[redacted]", email: "a@x.com" },
      });
    });

    it("returns primitives unchanged", () => {
      expect(applySafetyNet("hello", { mode: "mask" })).toBe("hello");
      expect(applySafetyNet(42, { mode: "mask" })).toBe(42);
      expect(applySafetyNet(null, { mode: "mask" })).toBeNull();
    });

    it("handles arrays of objects", () => {
      const out = applySafetyNet([{ secret: "s" }, { id: "1" }], { mode: "mask" }) as unknown[];
      expect(out).toEqual([{ secret: "[redacted]" }, { id: "1" }]);
    });
  });

  describe("mode=throw", () => {
    it("throws SafetyNetViolationError on the first secret hit", () => {
      expect(() => applySafetyNet({ password: "p" }, { mode: "throw" })).toThrow(
        SafetyNetViolationError,
      );
    });

    it("does not throw on safe payloads", () => {
      expect(() => applySafetyNet({ id: "1" }, { mode: "throw" })).not.toThrow();
    });
  });

  describe("custom field list", () => {
    it("honors a project-specific list (e.g. `pinHash`)", () => {
      const out = applySafetyNet({ pinHash: "abc" }, { mode: "mask", fields: ["pinHash"] });
      expect(out).toEqual({ pinHash: "[redacted]" });
    });
  });
});
