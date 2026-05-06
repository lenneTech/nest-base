import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * E2E · Initial heap budget (SC.PERF.05).
 *
 * The PRD's `SC.PERF.05` caps the initial heap at 200 MB after a
 * cold boot with default-on features only. Iter-191 rewrites this
 * spec to spawn `scripts/measure-boot-heap.ts` as a separate child
 * process and take the median of 3 samples — same shape as
 * `heap-delta-by-features.e2e-spec.ts` (SC.BOOT.09).
 *
 * Why the rewrite: the previous in-process approach booted the
 * NestJS app inside the Vitest worker that runs the test. Under
 * parallel suite execution (~10 workers active simultaneously
 * across 420+ files), `process.memoryUsage().heapUsed` reflected
 * the cumulative state of every spec the worker had run AND every
 * concurrent child's allocation pressure — yielding a transient
 * `1 failed` flake every ~3rd run. Iter-182 wrapped SC.PERF.05 in
 * `run_gate_retry` to mask the symptom; iter-191 fixes the root
 * cause by isolating the measurement in a child process where
 * `heapUsed` reflects ONLY the boot-time allocation footprint.
 *
 * Why median-of-3 (vs. 5 in the delta spec): the budget assertion
 * is a single-direction floor (heap < 200 MB) so we don't need the
 * cross-condition stability the delta spec needs. Three samples
 * with --expose-gc + 5 s settle is enough to pin the median within
 * a few MB of the true cold-boot heap.
 */
const ROOT = resolve(__dirname, "..");
const HEAP_BUDGET_BYTES = 200 * 1024 * 1024;
const CHILD_TIMEOUT_MS = 90_000;

interface HeapMeasurement {
  readonly heapUsed: number;
  readonly rss: number;
}

function spawnMeasurement(): HeapMeasurement {
  const result = spawnSync("bun", ["run", "--expose-gc", "scripts/measure-boot-heap.ts"], {
    cwd: ROOT,
    env: { ...process.env },
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `measure-boot-heap exited with ${result.status}: stdout=${result.stdout} stderr=${result.stderr}`,
    );
  }
  const lines = result.stdout.trim().split("\n");
  const lastLine = lines[lines.length - 1];
  if (!lastLine) {
    throw new Error(`measure-boot-heap produced no output. stderr=${result.stderr}`);
  }
  const parsed = JSON.parse(lastLine) as HeapMeasurement;
  if (typeof parsed.heapUsed !== "number" || typeof parsed.rss !== "number") {
    throw new Error(`measure-boot-heap returned malformed JSON: ${lastLine}`);
  }
  return parsed;
}

function medianHeap(samples: HeapMeasurement[]): HeapMeasurement {
  const sortedHeap = [...samples].sort((a, b) => a.heapUsed - b.heapUsed);
  const sortedRss = [...samples].sort((a, b) => a.rss - b.rss);
  const mid = Math.floor(samples.length / 2);
  return {
    heapUsed: sortedHeap[mid]!.heapUsed,
    rss: sortedRss[mid]!.rss,
  };
}

describe("E2E · Initial heap budget (SC.PERF.05)", () => {
  it(
    "median heap of 3 cold-boot samples is under 200 MB (isolated child processes)",
    () => {
      const samples: HeapMeasurement[] = [];
      for (let i = 0; i < 3; i++) {
        samples.push(spawnMeasurement());
      }
      const median = medianHeap(samples);
      // Surface the actual median + range in the log so a near-budget
      // regression is visible from the test output even when the gate
      // stays green.
      const heapMib = (median.heapUsed / (1024 * 1024)).toFixed(1);
      const rssMib = (median.rss / (1024 * 1024)).toFixed(1);
      // eslint-disable-next-line no-console
      console.log(`[heap-budget] median heapUsed=${heapMib}MB rss=${rssMib}MB`);
      expect(median.heapUsed).toBeLessThan(HEAP_BUDGET_BYTES);
    },
    5 * 60_000,
  );
});
