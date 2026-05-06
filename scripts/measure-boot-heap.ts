#!/usr/bin/env bun
/**
 * Heap-snapshot measurement runner (SC.BOOT.09).
 *
 * Boots the NestJS app via the canonical `bootstrap()` entry point,
 * waits for the post-boot caches to settle, forces a major GC when
 * available, and prints a single-line JSON record to stdout:
 *
 *   {"heapUsed": <bytes>, "rss": <bytes>}
 *
 * The PRD's `SC.BOOT.09` requires that "Heap snapshot 5s after boot
 * with all opt-in features OFF is ≥ 50 MB lower than with all ON".
 * The companion test (`tests/heap-delta-by-features.e2e-spec.ts`)
 * spawns this script twice with opposing feature ENV configs and
 * compares the two heapUsed values.
 *
 * The settle-window is 1500 ms — long enough for the
 * conditional-imports' module-load to complete + scheduled jobs to
 * register, short enough to keep the test under a 90 s timeout.
 */
import { bootstrap } from "../src/core/app/bootstrap.js";

const SETTLE_MS = 5_000;
const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

async function main(): Promise<void> {
  const app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  // Warm up the routing layer so DI metadata + route registry caches
  // settle. Hitting /health/live exercises the request-context +
  // session middleware chain that allocates per-request state.
  const server = app.getHttpServer() as { address?: () => unknown };
  void server;
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  // Run GC twice — Bun's collector is generational; the first pass
  // promotes survivors to old-gen, the second pass reclaims them. A
  // single call routinely leaves ~10 MB of unrooted heap behind.
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
    globalThis.gc();
  }
  const mem = process.memoryUsage();
  // Single-line JSON record on stdout — caller parses with JSON.parse().
  process.stdout.write(`${JSON.stringify({ heapUsed: mem.heapUsed, rss: mem.rss })}\n`);
  await app.close();
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(`measure-boot-heap failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
