/**
 * Pure planner for the Vitest globalSetup database strategy.
 *
 * Bun auto-loads `.env` at process start, so a fresh consumer
 * workspace exposes its dev `DATABASE_URL` to the test runner whether
 * the operator wanted it or not. Branching on `if (!DATABASE_URL)`
 * (the legacy behaviour) silently turned `bun run test:e2e` into
 * "drop my dev DB" the first time it ran. The planner makes the
 * decision explicit and writes the reasoning into the log so a fresh
 * consumer can see what happened.
 *
 * Decision matrix:
 *
 *   - `TEST_DATABASE_URL` set    → reuse-existing (CI service container).
 *   - `TEST_REUSE_DEV_DB=1`      → reuse-existing (destructive opt-in).
 *   - any other state            → spawn-container (default).
 *
 * Spawning still respects `DATABASE_URL` IF the operator explicitly
 * opted in via `TEST_REUSE_DEV_DB=1`. Without that flag, the runner
 * MUST clear the inherited URL (`clearDatabaseUrl: true`) so the
 * fresh testcontainer's connection string actually wins.
 */

export interface TestDatabaseStrategyInput {
  env: Record<string, string | undefined>;
}

export interface TestDatabaseStrategyPlan {
  /** Which storage backs the test run. */
  strategy: "spawn-container" | "reuse-existing";
  /**
   * When `strategy === "reuse-existing"`, the URL the runner should
   * advertise via `process.env.DATABASE_URL`. Always defined for
   * "reuse-existing", undefined for "spawn-container".
   */
  useUrl?: string;
  /**
   * When `strategy === "spawn-container"`, signals the runner to
   * delete `process.env.DATABASE_URL` before starting the container,
   * otherwise the inherited dev URL would survive the testcontainer
   * boot and downstream Prisma calls would race between the two.
   */
  clearDatabaseUrl: boolean;
  /** One-line operator-visible reason. Always present. */
  reason: string;
  /**
   * Surface a destructive-opt-in warning when reusing an inherited
   * DATABASE_URL. Undefined on the safe default path.
   */
  warning?: string;
}

const TEST_REUSE_DEV_DB_ENABLE_VALUES = new Set(["1"]);

export function planTestDatabaseStrategy(
  input: TestDatabaseStrategyInput,
): TestDatabaseStrategyPlan {
  const { env } = input;

  const ciUrl = env.TEST_DATABASE_URL;
  if (ciUrl && ciUrl.length > 0) {
    return {
      strategy: "reuse-existing",
      useUrl: ciUrl,
      clearDatabaseUrl: false,
      reason: "TEST_DATABASE_URL is set — reusing the CI service container.",
    };
  }

  const optIn = env.TEST_REUSE_DEV_DB ?? "";
  const reuseDevDb = TEST_REUSE_DEV_DB_ENABLE_VALUES.has(optIn);

  if (reuseDevDb) {
    const url = env.DATABASE_URL;
    if (!url) {
      // Defensive: TEST_REUSE_DEV_DB=1 without an inherited URL is
      // operator confusion. Fall back to the safe default rather than
      // throw, so a typo in CI doesn't take down the whole suite.
      return {
        strategy: "spawn-container",
        clearDatabaseUrl: false,
        reason:
          "TEST_REUSE_DEV_DB=1 but DATABASE_URL is empty — spawning a fresh testcontainer instead.",
      };
    }
    return {
      strategy: "reuse-existing",
      useUrl: url,
      clearDatabaseUrl: false,
      reason: "TEST_REUSE_DEV_DB=1 — reusing the inherited DATABASE_URL.",
      warning:
        "TEST_REUSE_DEV_DB=1 is destructive; tests will write to and drop rows from the dev DB.",
    };
  }

  // Default: always spawn an isolated testcontainer. If a stale
  // DATABASE_URL was inherited from `.env`, signal the runner to
  // clear it so the just-booted container's URL wins.
  const inheritedUrl = env.DATABASE_URL;
  return {
    strategy: "spawn-container",
    clearDatabaseUrl: Boolean(inheritedUrl),
    reason: inheritedUrl
      ? "Inherited DATABASE_URL detected — spawning isolated testcontainer (set TEST_REUSE_DEV_DB=1 to override; destructive)."
      : "No DATABASE_URL inherited — spawning isolated testcontainer.",
  };
}
