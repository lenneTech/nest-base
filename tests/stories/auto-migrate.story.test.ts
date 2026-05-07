import { describe, expect, it } from "vitest";

import { planAutoMigration } from "../../src/core/setup/auto-migrate.js";

describe("Story · Auto-migrate planner", () => {
  describe("returns migrate action in normal conditions", () => {
    it("listen=true, env=development → action=migrate", () => {
      const plan = planAutoMigration({ env: "development", listen: true });
      expect(plan.action).toBe("migrate");
    });

    it("listen=true, env=production → action=migrate", () => {
      const plan = planAutoMigration({ env: "production", listen: true });
      expect(plan.action).toBe("migrate");
    });

    it("listen=true, env=undefined → action=migrate", () => {
      const plan = planAutoMigration({ env: undefined, listen: true });
      expect(plan.action).toBe("migrate");
    });

    it("uses bunx prisma migrate deploy by default", () => {
      const plan = planAutoMigration({ env: "development", listen: true });
      if (plan.action !== "migrate") throw new Error("expected migrate action");
      expect(plan.command).toBe("bunx");
      expect(plan.args).toEqual(["prisma", "migrate", "deploy"]);
    });

    it("respects custom command override", () => {
      const plan = planAutoMigration({
        env: "development",
        listen: true,
        command: "npx",
      });
      if (plan.action !== "migrate") throw new Error("expected migrate action");
      expect(plan.command).toBe("npx");
      expect(plan.args).toEqual(["prisma", "migrate", "deploy"]);
    });
  });

  describe("returns skip action when appropriate", () => {
    it("listen=false → action=skip", () => {
      const plan = planAutoMigration({ env: "development", listen: false });
      expect(plan.action).toBe("skip");
    });

    it("env=test → action=skip", () => {
      const plan = planAutoMigration({ env: "test", listen: true });
      expect(plan.action).toBe("skip");
    });

    it("listen=false AND env=test → action=skip", () => {
      const plan = planAutoMigration({ env: "test", listen: false });
      expect(plan.action).toBe("skip");
    });
  });

  describe("skip reason is descriptive", () => {
    it("listen=false reason mentions listen", () => {
      const plan = planAutoMigration({ env: "development", listen: false });
      if (plan.action !== "skip") throw new Error("expected skip action");
      expect(plan.reason.toLowerCase()).toContain("listen");
    });

    it("env=test reason mentions test", () => {
      const plan = planAutoMigration({ env: "test", listen: true });
      if (plan.action !== "skip") throw new Error("expected skip action");
      expect(plan.reason.toLowerCase()).toContain("test");
    });
  });
});
