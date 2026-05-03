import { describe, expect, it } from "vitest";

import { planDbReset } from "../../src/core/setup/db-reset.js";

/**
 * Story · `bun run reset`.
 *
 * Wipe-Migrate-Seed cycle in one command. The pure planner returns
 * the ordered list of operations the runner executes via Bun.spawn.
 * Tests verify the order, the safety guards, and the env-pass-through
 * (DATABASE_URL must reach prisma migrate reset).
 */
describe("Story · planDbReset", () => {
  function defaults() {
    return {
      env: { DATABASE_URL: "postgres://u:p@localhost:5432/app" },
      seedScript: true,
    };
  }

  it("returns wipe → migrate → verify → seed in that order on dev", () => {
    const plan = planDbReset({ ...defaults(), nodeEnv: "development" });
    expect(plan.allowed).toBe(true);
    const verbs = plan.steps.map((s) => s.verb);
    expect(verbs).toEqual(["wipe", "migrate", "verify", "seed"]);
  });

  it("includes prepare:schema in front when feature-gated schemas are configured", () => {
    const plan = planDbReset({
      ...defaults(),
      nodeEnv: "development",
      hasFeatureSchemas: true,
    });
    const verbs = plan.steps.map((s) => s.verb);
    expect(verbs[0]).toBe("prepare-schema");
    expect(verbs).toContain("wipe");
    expect(verbs).toContain("migrate");
  });

  it("skips the seed step when no seed script is configured", () => {
    const plan = planDbReset({ ...defaults(), nodeEnv: "development", seedScript: false });
    expect(plan.steps.map((s) => s.verb)).not.toContain("seed");
  });

  it("forwards DATABASE_URL to every step", () => {
    const plan = planDbReset({ ...defaults(), nodeEnv: "development" });
    for (const step of plan.steps) {
      expect(step.env.DATABASE_URL).toBe("postgres://u:p@localhost:5432/app");
    }
  });

  it("REFUSES to run on production (safety gate)", () => {
    const plan = planDbReset({ ...defaults(), nodeEnv: "production" });
    expect(plan.allowed).toBe(false);
    expect(plan.steps).toHaveLength(0);
    expect(plan.refusalReason).toMatch(/production/i);
  });

  it("REFUSES when DATABASE_URL is missing", () => {
    const plan = planDbReset({ env: {}, seedScript: true, nodeEnv: "development" });
    expect(plan.allowed).toBe(false);
    expect(plan.refusalReason).toMatch(/DATABASE_URL/);
  });

  it("REFUSES on a hostname that doesn't look local (defense-in-depth)", () => {
    const plan = planDbReset({
      env: { DATABASE_URL: "postgres://u:p@prod-db.example.com:5432/app" },
      seedScript: true,
      nodeEnv: "development",
    });
    expect(plan.allowed).toBe(false);
    expect(plan.refusalReason).toMatch(/non-local|host/i);
  });

  it("allows 127.0.0.1 + localhost + docker compose service names", () => {
    for (const host of ["localhost", "127.0.0.1", "postgres", "db"]) {
      const plan = planDbReset({
        env: { DATABASE_URL: `postgres://u:p@${host}:5432/app` },
        seedScript: true,
        nodeEnv: "development",
      });
      expect(plan.allowed, `host ${host} should be allowed`).toBe(true);
    }
  });

  it("each step has a 'bun' or 'bunx' command (no shell-out to npm/node)", () => {
    const plan = planDbReset({
      ...defaults(),
      nodeEnv: "development",
      hasFeatureSchemas: true,
    });
    for (const step of plan.steps) {
      expect(["bun", "bunx"]).toContain(step.command);
    }
  });

  it("runs a verify step between migrate and seed so empty schemas fail fast", () => {
    // Friction-log #4: when `_prisma_migrations` survives the wipe,
    // `migrate deploy` reports success but doesn't create any tables.
    // Without a verify step the failure surfaces inside seed as a
    // confusing P2021 hours later. The verify step probes the public
    // schema right after migrate and aborts the chain with a remediation
    // hint, before seed even tries to talk to Prisma.
    const plan = planDbReset({ ...defaults(), nodeEnv: "development" });
    const verbs = plan.steps.map((s) => s.verb);
    expect(verbs).toEqual(["wipe", "migrate", "verify", "seed"]);
  });

  it("the verify step still runs when no seed script is configured", () => {
    const plan = planDbReset({ ...defaults(), nodeEnv: "development", seedScript: false });
    const verbs = plan.steps.map((s) => s.verb);
    expect(verbs).toContain("verify");
    expect(verbs).not.toContain("seed");
  });
});
