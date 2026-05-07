/**
 * Auto-migration planner for `prisma migrate deploy`.
 *
 * Pure function: boot flags + env → either a migrate plan or a skip
 * reason. The runner in `auto-migrate-runner.ts` calls
 * `spawnSync(plan.command, plan.args)` and aborts bootstrap on a
 * non-zero exit code. No I/O in this file — tests run without Docker.
 *
 * Skip rules:
 *   - `listen` is false (test bootstrap path, skip to keep e2e fast)
 *   - `env === "test"` (Vitest sets NODE_ENV=test; never migrate test DB)
 */

export type AutoMigratePlan =
  | { action: "migrate"; command: string; args: string[] }
  | { action: "skip"; reason: string };

export interface AutoMigrateInput {
  /** Value of NODE_ENV. Undefined is treated as non-test → migrate. */
  env: string | undefined;
  /** Bootstrap listen flag. False in e2e test boots. */
  listen: boolean;
  /** Override the executable. Defaults to "bunx". */
  command?: string;
}

/**
 * Decide whether to run `prisma migrate deploy` at boot.
 *
 * Returns a `migrate` plan when the server is booting for real
 * (listen=true) in a non-test environment. Returns a `skip` plan
 * with a human-readable reason in all other cases.
 */
export function planAutoMigration(input: AutoMigrateInput): AutoMigratePlan {
  // Test boots skip migration: Vitest testcontainers apply migrations via
  // the global-setup hook; running migrate deploy again would be redundant
  // and would slow every test file boot.
  if (input.env === "test") {
    return { action: "skip", reason: "NODE_ENV is test — skipping auto-migrate" };
  }

  // When listen=false the app is being constructed without binding a port
  // (unit/e2e test bootstrap). Migration must not run against the test DB.
  if (!input.listen) {
    return { action: "skip", reason: "listen=false — skipping auto-migrate" };
  }

  return {
    action: "migrate",
    command: input.command ?? "bunx",
    args: ["prisma", "migrate", "deploy"],
  };
}
