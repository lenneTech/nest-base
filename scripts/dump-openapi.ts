#!/usr/bin/env bun
/**
 * `bun run dump:openapi` — regenerate `docs/openapi.snapshot.json` so
 * frontend consumers can run `openapi-ts --input` against the file
 * when the dev API isn't booted.
 *
 * Why a checked-in snapshot:
 *   - Frontend agents can generate `app/api-client/{types,sdk}.gen.ts`
 *     without booting the dev runner — useful when the dev runner is
 *     broken, when working frontend-first, or in CI environments that
 *     don't spin the full backend.
 *   - The snapshot is the load-bearing input for
 *     `tests/stories/openapi-snapshot.story.test.ts`, which fails CI
 *     on drift so a contributor who adds a route can't forget to
 *     regenerate the file.
 *
 * Implementation: delegate to vitest. The story test boots NestJS in
 * the same worker it later asserts against — it picks up
 * `UPDATE_OPENAPI_SNAPSHOT=1` and writes the file before the
 * comparison runs. Sharing the vitest transform pipeline with the
 * assertion is what keeps the snapshot byte-equal to "what the test
 * would accept" — Bun's native TS loader and vite-node's loader emit
 * different decorator-metadata, so a Bun-side dump would drift in
 * exactly the parameters the test reflects on.
 *
 * Usage:
 *   bun run dump:openapi              # write docs/openapi.snapshot.json
 *   bun run dump:openapi --check      # exit non-zero on drift
 */
import { spawnSync } from "node:child_process";

const STORY_PATH = "tests/stories/openapi-snapshot.story.test.ts";

function runVitest(env: NodeJS.ProcessEnv, label: string): number {
  process.stderr.write(`[dump:openapi] ${label}…\n`);
  const result = spawnSync(
    "bunx",
    ["vitest", "run", STORY_PATH, "--passWithNoTests"],
    {
      env: { ...process.env, ...env },
      stdio: "inherit",
    },
  );
  return result.status ?? 1;
}

function main(): void {
  const checkOnly = process.argv.includes("--check");

  if (checkOnly) {
    // Run the story unmodified — it asserts the on-disk snapshot
    // matches what bootstrap() emits. Drift fails the test, which
    // exits non-zero, which is exactly the signal we want.
    const status = runVitest({}, "verifying snapshot");
    process.exit(status);
  }

  const status = runVitest(
    { UPDATE_OPENAPI_SNAPSHOT: "1" },
    "regenerating docs/openapi.snapshot.json",
  );
  process.exit(status);
}

main();
