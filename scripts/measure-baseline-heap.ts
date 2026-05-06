#!/usr/bin/env bun
/**
 * Diagnostic — measure what's in the heap WITHOUT booting NestJS.
 *
 * Distinguishes "Bun runtime + npm-deps eager load" baseline from
 * "NestJS app boot" overhead. Helps quantify the SC.BOOT.09 ceiling:
 * if Bun + Prisma + Better-Auth alone consume 60+ MB, then a 50 MB
 * delta from feature gating is unreachable regardless of architecture.
 *
 * Prints two single-line JSON records:
 *   {"phase": "bare", "heapUsed": ..., "rss": ...}        — only Bun
 *   {"phase": "with-npm-deps", "heapUsed": ..., "rss": ...} — common deps
 */
function gc2(): void {
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
    globalThis.gc();
  }
}

async function main(): Promise<void> {
  // Phase 1: pure Bun runtime, no app code.
  gc2();
  const bare = process.memoryUsage();
  process.stdout.write(`${JSON.stringify({ phase: "bare", heapUsed: bare.heapUsed, rss: bare.rss })}\n`);

  // Phase 2: load the always-on npm deps that EVERY route exercises.
  // These don't go through the feature flag and represent the
  // architectural floor of the heap.
  await import("@nestjs/core");
  await import("@nestjs/common");
  await import("@nestjs/platform-express");
  await import("@nestjs/throttler");
  await import("better-auth");
  await import("@prisma/client");
  await import("zod");

  gc2();
  const deps = process.memoryUsage();
  process.stdout.write(
    `${JSON.stringify({ phase: "with-npm-deps", heapUsed: deps.heapUsed, rss: deps.rss })}\n`,
  );

  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(`measure-baseline-heap failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
