import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * Story · `bun run prepare:schema --check` drift gate (SC.QG.12).
 *
 * The PRD's `SC.QG.12` requires `bun run prepare:schema:check` to exit
 * non-zero when `prisma/schema.generated.prisma` diverges from what
 * `concatenateSchema()` produces for the active feature set, and to
 * exit zero otherwise. Without this gate, a contributor who forgets
 * to run `bun run prepare:schema` after editing `prisma/features/*.prisma`
 * can ship a schema that is silently out-of-sync with the source files.
 *
 * The script preserves a non-`--check` invocation as the canonical
 * write path: that's what the contributor runs to refresh the file.
 */

const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = resolve(ROOT, "scripts/prepare-schema.ts");
const GENERATED = resolve(ROOT, "prisma/schema.generated.prisma");

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runPrepareSchema(args: string[]): SpawnResult {
  const result = spawnSync("bun", ["run", SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("Story · prepare:schema --check drift gate", () => {
  let baseline: string;

  beforeAll(() => {
    baseline = readFileSync(GENERATED, "utf8");
  });

  afterEach(() => {
    // Restore baseline so failed assertions don't leave the tree dirty.
    writeFileSync(GENERATED, baseline, "utf8");
  });

  it("exits 0 when generated matches committed (in-sync tree)", () => {
    // First refresh the generated file so we know it's exactly what
    // concatenateSchema would produce right now.
    const refresh = runPrepareSchema([]);
    expect(refresh.exitCode).toBe(0);

    const result = runPrepareSchema(["--check"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/no drift|matches|in sync/i);
  });

  it("exits 1 when generated diverges from concatenated source", () => {
    // Refresh first to get a known-good baseline.
    runPrepareSchema([]);
    const knownGood = readFileSync(GENERATED, "utf8");

    // Introduce drift: append a comment line that wouldn't be produced
    // by concatenateSchema().
    writeFileSync(GENERATED, knownGood + "\n// drift introduced by test\n", "utf8");

    const result = runPrepareSchema(["--check"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/drift|diverge|out.of.sync/i);
  });

  it("does not modify the generated file in --check mode", () => {
    runPrepareSchema([]);
    const before = readFileSync(GENERATED, "utf8");
    runPrepareSchema(["--check"]);
    const after = readFileSync(GENERATED, "utf8");
    expect(after).toBe(before);
  });
});
