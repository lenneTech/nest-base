import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CHECK_RLS_SCRIPT = readFileSync(resolve(REPO_ROOT, "scripts/check-rls.ts"), "utf8");

/**
 * Story · `bun run check:rls` loads the workspace `.env` with
 * `override: true` so a stale shell `DATABASE_URL` cannot point the
 * runtime check at the wrong database.
 *
 * Friction-log entry (LLM-test 2026-05-04 #5 medium): a leftover
 * `DATABASE_URL=postgresql://nest-base:...@localhost:5432/nest-base`
 * exported from a prior session silently shadowed the workspace's
 * `projects/api/.env`, so `bun run check:rls --runtime` connected to
 * the wrong DB and reported every tenant-scoped table as "Table
 * missing at runtime" — false negatives that derail the setup gate.
 *
 * `prisma.config.ts` already solves this for `prisma migrate` /
 * `prisma:generate` by importing `dotenv` with `override: true`. The
 * RLS runtime checker is per-workspace too, so the same pattern is the
 * only correct answer here. Both the static scan and the runtime scan
 * should agree on a freshly-migrated workspace, regardless of what the
 * parent shell has exported.
 *
 * This is a "loader call shape" test — we assert that the script
 * imports `dotenv` and invokes its loader with `override: true` BEFORE
 * any code that reads `process.env.DATABASE_URL`. We deliberately do
 * NOT execute the runner here (it would hit the file system + a real
 * Postgres). The companion unit/integration tests for the planners
 * (`rls-audit-planner`, `rls-runtime-planner`) cover behaviour.
 */
describe("Story · check:rls loads the workspace .env (override:true)", () => {
  it("imports `config as loadEnv` from dotenv at the top of the script", () => {
    expect(CHECK_RLS_SCRIPT).toMatch(
      /import\s+\{\s*config\s+as\s+loadEnv\s*\}\s+from\s+["']dotenv["']/,
    );
  });

  it("invokes the dotenv loader with `override: true`", () => {
    // Match `loadEnv({ override: true })` allowing any whitespace or
    // additional trailing keys (we only require override:true to be
    // among them so a stale shell value can never win).
    expect(CHECK_RLS_SCRIPT).toMatch(/loadEnv\(\s*\{[^}]*override:\s*true[^}]*\}\s*\)/);
  });

  it("loads `.env` BEFORE the first `process.env.DATABASE_URL` read", () => {
    const loaderIdx = CHECK_RLS_SCRIPT.indexOf("loadEnv(");
    const dbUrlIdx = CHECK_RLS_SCRIPT.indexOf("process.env.DATABASE_URL");
    expect(loaderIdx).toBeGreaterThan(-1);
    expect(dbUrlIdx).toBeGreaterThan(-1);
    expect(loaderIdx).toBeLessThan(dbUrlIdx);
  });
});
