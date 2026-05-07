/**
 * Thin runner for the auto-migration planner.
 *
 * Calls `spawnSync` with the command + args from the plan. stdio is
 * inherited so Prisma's migration output (applied migration names,
 * "Database schema is up to date" confirmation) flows to the terminal.
 *
 * A non-zero exit code aborts bootstrap with a clear error so the
 * server never starts with a broken schema silently.
 */

import { spawnSync } from "node:child_process";

import type { AutoMigratePlan } from "./auto-migrate.js";

export async function runAutoMigrate(plan: AutoMigratePlan): Promise<void> {
  if (plan.action === "skip") {
    // Nothing to do. The planner already encoded the reason; the caller
    // can log it at debug level if desired. No console.log here.
    return;
  }

  const result = spawnSync(plan.command, plan.args, {
    // Forward Prisma's output (migration names, "up to date" message)
    // to the terminal so the operator can see what happened at boot.
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(
      `prisma migrate deploy exited with code ${result.status ?? "unknown"} — ` +
        `bootstrap aborted to prevent starting with a mismatched schema`,
    );
  }
}
