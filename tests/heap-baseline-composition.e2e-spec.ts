import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * E2E · Heap baseline composition (SC.BOOT.09 diagnostic).
 *
 * Spawns `scripts/measure-baseline-heap.ts` to quantify the
 * always-on heap floor: pure Bun runtime vs. Bun + the always-on
 * npm dependencies (`@nestjs/*`, `better-auth`, `@prisma/client`,
 * `zod`). The numbers explain why SC.BOOT.09's ≥50 MB delta target
 * is structurally unreachable with the current codebase composition
 * — the always-on infrastructure dominates the heap, leaving very
 * little optional weight for feature flags to remove.
 *
 * The assertions are intentionally loose: the test serves as a
 * regression gate against accidental eager-load of heavy deps, NOT
 * a tight performance budget. A future regression that bloats bare
 * Bun past 50 MB or pushes the npm-deps cost past 30 MB would
 * indicate something has gone wrong in the dependency tree.
 */
const ROOT = resolve(__dirname, "..");
const CHILD_TIMEOUT_MS = 30_000;
const BARE_BUN_HEAP_CEILING_MB = 50;
const NPM_DEPS_HEAP_CEILING_MB = 30;

interface PhaseRecord {
  readonly phase: "bare" | "with-npm-deps";
  readonly heapUsed: number;
  readonly rss: number;
}

function measureBaseline(): readonly PhaseRecord[] {
  const result = spawnSync("bun", ["run", "--expose-gc", "scripts/measure-baseline-heap.ts"], {
    cwd: ROOT,
    env: { ...process.env },
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `measure-baseline-heap exited with ${result.status}: stdout=${result.stdout} stderr=${result.stderr}`,
    );
  }

  const lines = result.stdout
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
  return lines.map((line) => JSON.parse(line) as PhaseRecord);
}

describe("E2E · Heap baseline composition (SC.BOOT.09 diagnostic)", () => {
  let bare: PhaseRecord;
  let withNpmDeps: PhaseRecord;

  beforeAll(() => {
    const records = measureBaseline();
    const bareRecord = records.find((r) => r.phase === "bare");
    const npmRecord = records.find((r) => r.phase === "with-npm-deps");
    if (!bareRecord) {
      throw new Error("missing 'bare' phase record");
    }
    if (!npmRecord) {
      throw new Error("missing 'with-npm-deps' phase record");
    }
    bare = bareRecord;
    withNpmDeps = npmRecord;
  }, 60_000);

  afterAll(() => {
    const bareMb = (bare.heapUsed / 1024 / 1024).toFixed(2);
    const npmMb = (withNpmDeps.heapUsed / 1024 / 1024).toFixed(2);
    const deltaMb = ((withNpmDeps.heapUsed - bare.heapUsed) / 1024 / 1024).toFixed(2);
    process.stdout.write(
      `[heap-baseline] bare=${bareMb} MB · with-npm-deps=${npmMb} MB · delta=${deltaMb} MB rss-bare=${(bare.rss / 1024 / 1024).toFixed(1)}MB rss-deps=${(withNpmDeps.rss / 1024 / 1024).toFixed(1)}MB\n`,
    );
  });

  it("bare Bun runtime heap is well under the SC.BOOT.09 PRD target (regression gate)", () => {
    const heapMb = bare.heapUsed / 1024 / 1024;
    expect(
      heapMb,
      `bare Bun heap was ${heapMb.toFixed(2)} MB, expected < ${BARE_BUN_HEAP_CEILING_MB} MB`,
    ).toBeLessThan(BARE_BUN_HEAP_CEILING_MB);
  });

  it("always-on npm dependencies cost is bounded (regression gate)", () => {
    const depsCostMb = (withNpmDeps.heapUsed - bare.heapUsed) / 1024 / 1024;
    expect(
      depsCostMb,
      `npm-deps load cost was ${depsCostMb.toFixed(2)} MB, expected < ${NPM_DEPS_HEAP_CEILING_MB} MB`,
    ).toBeLessThan(NPM_DEPS_HEAP_CEILING_MB);
  });

  it("loading npm-deps is monotonic (heap with deps ≥ bare heap)", () => {
    expect(withNpmDeps.heapUsed).toBeGreaterThanOrEqual(bare.heapUsed);
    expect(withNpmDeps.rss).toBeGreaterThanOrEqual(bare.rss);
  });
});
