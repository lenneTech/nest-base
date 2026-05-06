#!/usr/bin/env bun
/**
 * `bun run sdk:check` — validates that `docs/openapi.snapshot.json` is
 * consumable by kubb without errors.
 *
 * Why this gate exists:
 *   - The frontend consumer generates its typed SDK from the offline
 *     snapshot via `kubb generate -c kubb.config.ts` (with KUBB_INPUT
 *     pointed at the snapshot). If the snapshot ever drifts into a
 *     shape kubb cannot consume — duplicate operationIds, malformed
 *     schemas, missing components — the consumer build breaks.
 *   - This script catches that breakage in the template's CI before
 *     it reaches downstream projects.
 *
 * Behaviour:
 *   1. Verifies the snapshot file exists and parses as JSON. Exit 1
 *      with a clear message if either fails.
 *   2. Runs kubb against the snapshot, with output redirected to a
 *      tempdir under `node_modules/.cache/sdk-check/` so the run does
 *      not touch the gitignored `generated/` directory the developer
 *      may rely on.
 *   3. Exits with kubb's status. The output is a clean tempdir on
 *      success; the runner cleans it up after.
 *
 * Env overrides (used by tests):
 *   SDK_CHECK_SNAPSHOT_PATH — override the snapshot path.
 *   SDK_CHECK_OUTPUT_DIR    — override the kubb output directory.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const DEFAULT_SNAPSHOT = resolve(ROOT, "docs/openapi.snapshot.json");
const DEFAULT_OUTPUT = resolve(ROOT, "node_modules/.cache/sdk-check/sdk");

const snapshotPath = process.env.SDK_CHECK_SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT;
const outputDir = process.env.SDK_CHECK_OUTPUT_DIR ?? DEFAULT_OUTPUT;

function fatal(message: string, code = 1): never {
  console.error(`[sdk:check] ${message}`);
  process.exit(code);
}

// ─── Step 1: snapshot exists ────────────────────────────────────
if (!existsSync(snapshotPath)) {
  fatal(`snapshot missing — expected ${snapshotPath} (run \`bun run dump:openapi\` first)`);
}

// ─── Step 2: snapshot parses as JSON ────────────────────────────
let snapshotContents: string;
try {
  snapshotContents = readFileSync(snapshotPath, "utf8");
} catch (err) {
  fatal(`failed to read snapshot at ${snapshotPath}: ${(err as Error).message}`);
}

try {
  JSON.parse(snapshotContents);
} catch (err) {
  fatal(`snapshot is invalid JSON — parse error: ${(err as Error).message}`);
}

// ─── Step 3: tempdir setup ──────────────────────────────────────
// Ensure clean output dir so a previous run's bytes can't mask drift.
if (existsSync(outputDir)) {
  rmSync(outputDir, { recursive: true, force: true });
}
mkdirSync(outputDir, { recursive: true });

// ─── Step 4: run kubb against the snapshot ──────────────────────
const result = spawnSync("bunx", ["kubb", "generate", "-c", "kubb.config.ts"], {
  cwd: ROOT,
  encoding: "utf8",
  env: {
    ...process.env,
    KUBB_INPUT: snapshotPath,
    KUBB_OUTPUT: outputDir,
  },
});

const exitCode = result.status ?? 1;
if (exitCode !== 0) {
  console.error(`[sdk:check] kubb generation failed:`);
  console.error(result.stderr || result.stdout || "(no output)");
  process.exit(exitCode);
}

console.log(`[sdk:check] kubb generated SDK from ${snapshotPath} into ${outputDir} — no drift`);

// Cleanup the tempdir so disk doesn't accumulate stale outputs.
rmSync(outputDir, { recursive: true, force: true });

process.exit(0);
