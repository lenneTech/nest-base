import { describe, expect, it } from "vitest";

import { planDbWipe, planSchemaSanityCheck } from "../../src/core/setup/db-wipe.js";

/**
 * Story · `bun run scripts/wipe-db.ts`.
 *
 * The wipe step runs before `prisma migrate deploy` and must leave
 * the database in a state where `migrate deploy` actually re-applies
 * every migration. Friction log run-2026-05-03 #4 caught a regression
 * where a stale `_prisma_migrations` row survived `DROP SCHEMA public
 * CASCADE` (Prisma 7 with the driver-adapter sometimes places the
 * journal table in a non-public schema, or it survives the cascade
 * because of an open session reattaching to the recreated schema).
 *
 * The fix is to extract the SQL into a pure planner so the runner
 * only loops over `statement` strings and the test pins the exact
 * recipe.
 */
describe("Story · planDbWipe", () => {
  it("drops the public schema first, then recreates it, then grants", () => {
    const plan = planDbWipe();
    const verbs = plan.steps.map((s) => s.verb);
    expect(verbs.indexOf("drop-schema")).toBeLessThan(verbs.indexOf("create-schema"));
    expect(verbs.indexOf("create-schema")).toBeLessThan(verbs.indexOf("grant-schema"));
  });

  it("explicitly drops `_prisma_migrations` after the schema reset", () => {
    const plan = planDbWipe();
    const verbs = plan.steps.map((s) => s.verb);
    // The drop runs even when the schema cascade should have removed
    // the table — Prisma 7 with the driver-adapter has been observed
    // leaving a stale row, and a redundant DROP TABLE IF EXISTS is
    // free.
    expect(verbs).toContain("drop-prisma-migrations-public");
    // `_prisma_migrations` may live outside `public` under Prisma 7.
    // Discovery before the targeted drop covers that case.
    expect(verbs).toContain("discover-prisma-migrations-schema");
    expect(verbs).toContain("drop-prisma-migrations-discovered");
  });

  it("public-schema drop happens before the targeted _prisma_migrations drop", () => {
    const plan = planDbWipe();
    const verbs = plan.steps.map((s) => s.verb);
    // The order matters: cascade first to clean up the common case,
    // then defensively drop any survivor row.
    expect(verbs.indexOf("drop-schema")).toBeLessThan(
      verbs.indexOf("drop-prisma-migrations-public"),
    );
    expect(verbs.indexOf("drop-schema")).toBeLessThan(
      verbs.indexOf("drop-prisma-migrations-discovered"),
    );
  });

  it("statements are SQL strings the runner can pass straight to pg `query`", () => {
    const plan = planDbWipe();
    for (const step of plan.steps) {
      expect(typeof step.statement).toBe("string");
      expect(step.statement.trim().length).toBeGreaterThan(0);
      // No semicolon clutter — the pg driver runs one statement per
      // call and rejects multi-statement strings under the simple
      // protocol the wipe runner uses.
      expect(step.statement.trim().endsWith(";"), `step ${step.verb} ends with ';'`).toBe(false);
    }
  });

  it("the public-schema drop targets `_prisma_migrations` by name (defensive)", () => {
    const plan = planDbWipe();
    const drop = plan.steps.find((s) => s.verb === "drop-prisma-migrations-public");
    expect(drop).toBeDefined();
    expect(drop!.statement.toLowerCase()).toContain("_prisma_migrations");
    expect(drop!.statement.toLowerCase()).toContain("if exists");
    expect(drop!.statement.toLowerCase()).toContain("public");
  });

  it("the discovery step reads from information_schema and matches the table by name", () => {
    const plan = planDbWipe();
    const discover = plan.steps.find((s) => s.verb === "discover-prisma-migrations-schema");
    expect(discover).toBeDefined();
    expect(discover!.statement.toLowerCase()).toContain("information_schema.tables");
    expect(discover!.statement.toLowerCase()).toContain("_prisma_migrations");
  });

  it("the discovered-schema drop is parameterised — runner substitutes the schema name", () => {
    const plan = planDbWipe();
    const drop = plan.steps.find((s) => s.verb === "drop-prisma-migrations-discovered");
    expect(drop).toBeDefined();
    // A placeholder marker the runner replaces with the result of the
    // discovery query. We DON'T inline the name here because the
    // planner is pure — it can't know what the discovery returned.
    expect(drop!.statement).toContain("__SCHEMA__");
  });
});

describe("Story · planSchemaSanityCheck", () => {
  it("returns a SQL probe that counts non-Prisma-internal tables in `public`", () => {
    const probe = planSchemaSanityCheck();
    expect(probe.statement.toLowerCase()).toContain("information_schema.tables");
    expect(probe.statement.toLowerCase()).toContain("public");
    expect(probe.statement.toLowerCase()).toContain("_prisma_");
  });

  it("ships a remediation hint when the count is zero", () => {
    const probe = planSchemaSanityCheck();
    expect(probe.failureMessage.toLowerCase()).toContain("migration");
    expect(probe.failureMessage.toLowerCase()).toContain("schema");
    // The hint must surface the stale-`_prisma_migrations` cause so
    // the next contributor doesn't have to re-debug from scratch.
    expect(probe.failureMessage.toLowerCase()).toContain("_prisma_migrations");
  });
});
