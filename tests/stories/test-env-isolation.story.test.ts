import { describe, expect, it } from "vitest";

import { planTestDatabaseStrategy } from "../../src/core/testing/test-database-strategy.js";

/**
 * Story · Test-Env-Isolation.
 *
 * Bun auto-loads `.env` at process start. A typical workspace ships
 * `DATABASE_URL=postgresql://…@localhost:5434/<workspace>` (the dev
 * Postgres). The legacy `tests/global-setup.ts` branched on
 * `if (!process.env.DATABASE_URL)` and skipped the testcontainer when
 * a URL was already present — which silently turned `bun run test:e2e`
 * into "rm your dev DB roulette".
 *
 * `planTestDatabaseStrategy()` is the pure planner that decides whether
 * the runner spawns a fresh testcontainer or reuses an inherited URL.
 * Default behaviour is **always testcontainer** unless the operator
 * explicitly sets `TEST_REUSE_DEV_DB=1` (destructive opt-in) or the
 * environment provides a dedicated CI service container via
 * `TEST_DATABASE_URL`. The planner never decides "reuse" silently.
 */
describe("Story · Test-Env-Isolation · planTestDatabaseStrategy", () => {
  it("defaults to spawning a fresh testcontainer when no env hints are present", () => {
    const plan = planTestDatabaseStrategy({ env: {} });
    expect(plan.strategy).toBe("spawn-container");
    // The runner uses this to decide whether to clear the inherited URL
    // before the container starts. With no hints, nothing to clear.
    expect(plan.clearDatabaseUrl).toBe(false);
  });

  it("spawns a testcontainer and CLEARS DATABASE_URL when only DATABASE_URL is set (Bun .env autoload)", () => {
    const plan = planTestDatabaseStrategy({
      env: { DATABASE_URL: "postgresql://my-app:secret@localhost:5434/my-app" },
    });
    expect(plan.strategy).toBe("spawn-container");
    expect(plan.clearDatabaseUrl).toBe(true);
    // The reason string surfaces in the global-setup log so a fresh
    // consumer sees why their dev DB wasn't touched.
    expect(plan.reason).toMatch(/spawn|isolated|testcontainer/i);
  });

  it("reuses an inherited DATABASE_URL only when TEST_REUSE_DEV_DB=1 is explicit", () => {
    const plan = planTestDatabaseStrategy({
      env: {
        DATABASE_URL: "postgresql://my-app:secret@localhost:5434/my-app",
        TEST_REUSE_DEV_DB: "1",
      },
    });
    expect(plan.strategy).toBe("reuse-existing");
    expect(plan.clearDatabaseUrl).toBe(false);
    expect(plan.reason).toMatch(/TEST_REUSE_DEV_DB/);
  });

  it("reuses CI service container when TEST_DATABASE_URL is set (no opt-in needed)", () => {
    const plan = planTestDatabaseStrategy({
      env: {
        DATABASE_URL: "postgresql://my-app:secret@localhost:5434/my-app",
        TEST_DATABASE_URL: "postgresql://ci:ci@postgres:5432/ci",
      },
    });
    expect(plan.strategy).toBe("reuse-existing");
    expect(plan.useUrl).toBe("postgresql://ci:ci@postgres:5432/ci");
    expect(plan.reason).toMatch(/TEST_DATABASE_URL|CI/i);
  });

  it("treats TEST_REUSE_DEV_DB=0 / unset values as opt-out (only `1` enables reuse)", () => {
    for (const flag of ["0", "false", "no", ""]) {
      const plan = planTestDatabaseStrategy({
        env: {
          DATABASE_URL: "postgresql://my-app:secret@localhost:5434/my-app",
          TEST_REUSE_DEV_DB: flag,
        },
      });
      expect(plan.strategy).toBe("spawn-container");
      expect(plan.clearDatabaseUrl).toBe(true);
    }
  });

  it("emits a warning string when reusing an inherited URL (operator visibility)", () => {
    const plan = planTestDatabaseStrategy({
      env: {
        DATABASE_URL: "postgresql://my-app:secret@localhost:5434/my-app",
        TEST_REUSE_DEV_DB: "1",
      },
    });
    expect(plan.warning).toBeDefined();
    // The warning must explicitly call out the destructive path so a
    // CI accident with `TEST_REUSE_DEV_DB=1` set globally still
    // surfaces in the test log.
    expect(plan.warning).toMatch(/destructive|dev DB|will write/i);
  });

  it("does not warn on the default spawn-container path (clean run, clean log)", () => {
    const plan = planTestDatabaseStrategy({
      env: { DATABASE_URL: "postgresql://my-app:secret@localhost:5434/my-app" },
    });
    expect(plan.warning).toBeUndefined();
  });
});
