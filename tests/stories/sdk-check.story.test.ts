import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * Story · `bun run sdk:check` validates the OpenAPI snapshot is consumable by kubb.
 *
 * The PRD's `SC.QG.13` requires `bun run sdk:check` to fail CI when the
 * SDK generator can't produce its TypeScript output from the offline
 * snapshot at `docs/openapi.snapshot.json`. Because the consuming
 * frontend generates its own typed client into a gitignored
 * `generated/sdk/` directory (see `.gitignore`), there is no
 * canonical checked-in SDK to diff against. The meaningful drift
 * signal for the template itself is therefore: "the snapshot is
 * well-formed, every operation can be turned into a TS module".
 *
 * sdk-check therefore:
 *   1. Verifies `docs/openapi.snapshot.json` exists.
 *   2. Spawns kubb pointing at the snapshot, with output redirected
 *      to a tempdir under `node_modules/.cache/sdk-check/`.
 *   3. Exits 0 if kubb succeeds, 1 on failure or missing snapshot.
 *
 * Future-proofing: when a consumer commits their generated SDK,
 * the script can grow a `--against=<path>` flag to do a tree-diff
 * against the committed copy. The single-source-of-truth interface
 * stays the same.
 */

const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = resolve(ROOT, "scripts/sdk-check.ts");
const SNAPSHOT = resolve(ROOT, "docs/openapi.snapshot.json");

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runSdkCheck(env: Record<string, string> = {}): SpawnResult {
  const result = spawnSync("bun", ["run", SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("Story · sdk:check kubb-consumability gate", () => {
  let snapshotBackup: string;

  beforeAll(() => {
    expect(existsSync(SNAPSHOT)).toBe(true);
    snapshotBackup = readFileSync(SNAPSHOT, "utf8");
  });

  afterEach(() => {
    // Restore in case a test corrupted the snapshot.
    writeFileSync(SNAPSHOT, snapshotBackup, "utf8");
  });

  it("exits 0 when the snapshot is a well-formed OpenAPI document", () => {
    const result = runSdkCheck();
    expect(
      result.exitCode,
      `sdk:check failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    ).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/sdk.check|kubb|generated/i);
  });

  it("exits 1 when the snapshot is missing", () => {
    const result = runSdkCheck({ SDK_CHECK_SNAPSHOT_PATH: "/nonexistent.json" });
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/missing|not found|does.not.exist/i);
  });

  it("exits 1 when the snapshot is malformed JSON", () => {
    writeFileSync(SNAPSHOT, "not valid json {{{", "utf8");
    const result = runSdkCheck();
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/json|parse|invalid|malformed/i);
  });
});
