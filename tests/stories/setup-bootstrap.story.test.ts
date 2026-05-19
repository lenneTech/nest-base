import { describe, expect, it } from "vitest";

import { planSetupBootstrap } from "../../src/core/setup/setup-bootstrap.js";

const baseInput = {
  env: { DATABASE_URL: "postgresql://app:secret@localhost:5432/app" },
  nodeEnv: "development",
  hasFeatureSchemas: true,
  hasSeedScript: true,
  hasDockerCompose: true,
};

describe("Story · setup bootstrap planner", () => {
  it("refuses production", () => {
    const plan = planSetupBootstrap({ ...baseInput, nodeEnv: "production" });
    expect(plan.allowed).toBe(false);
    expect(plan.refusalReason).toMatch(/production/);
  });

  it("refuses missing DATABASE_URL", () => {
    const plan = planSetupBootstrap({ ...baseInput, env: {} });
    expect(plan.allowed).toBe(false);
  });

  it("refuses remote DATABASE_URL hosts", () => {
    const plan = planSetupBootstrap({
      ...baseInput,
      env: { DATABASE_URL: "postgresql://u:p@db.example.com:5432/app" },
    });
    expect(plan.allowed).toBe(false);
  });

  it("plans docker, schema, generate, migrate, and seed by default", () => {
    const plan = planSetupBootstrap(baseInput);
    expect(plan.allowed).toBe(true);
    expect(plan.steps.map((s) => s.verb)).toEqual([
      "compose-up",
      "wait-postgres",
      "prepare-schema",
      "generate",
      "migrate",
      "seed",
    ]);
    expect(plan.steps[0]!.args).toContain("redis");
  });

  it("skips docker when skipDocker is set", () => {
    const plan = planSetupBootstrap({ ...baseInput, skipDocker: true });
    expect(plan.steps.map((s) => s.verb)).toEqual([
      "prepare-schema",
      "generate",
      "migrate",
      "seed",
    ]);
  });

  it("skips seed when skipSeed is set", () => {
    const plan = planSetupBootstrap({ ...baseInput, skipSeed: true });
    expect(plan.steps.at(-1)?.verb).toBe("migrate");
  });

  it("omits prepare-schema when no feature schemas exist", () => {
    const plan = planSetupBootstrap({ ...baseInput, hasFeatureSchemas: false });
    expect(plan.steps.map((s) => s.verb)).not.toContain("prepare-schema");
  });
});
