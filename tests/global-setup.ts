/**
 * Vitest globalSetup hook.
 *
 * Runs once before any test file. Currently a stub — will be filled with
 * testcontainers-based Postgres bootstrap in the Green phase.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  return async () => {
    // teardown noop
  };
}
