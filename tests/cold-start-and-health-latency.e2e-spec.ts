import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

/**
 * E2E · Cold-start + /health/live latency budgets (SC.BOOT.01 + SC.BOOT.02 + SC.PERF.01 + SC.PERF.02).
 *
 * The PRD's `SC.BOOT.01` / `SC.PERF.01` cap cold start at 5s on an
 * M-series Mac (default-on features only). `SC.BOOT.02` /
 * `SC.PERF.02` cap median /health/live latency at 50ms, exercised
 * across N=20 calls so a single jittered hit doesn't blow the budget.
 *
 * The bootstrap path here intentionally mirrors what `bun run dev`
 * does — same NestJS module, same providers, same middleware — so
 * the timing is representative of the cold-start-on-laptop path.
 *
 * Tests run inside the existing testcontainer; the timing budgets
 * are already calibrated for that environment.
 */
const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const HEALTH_LIVE_BUDGET_MS = 50;
const COLD_START_BUDGET_MS = 5_000;
const HEALTH_PROBE_SAMPLE_SIZE = 20;

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >>> 1;
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

describe("E2E · Cold-start + /health/live latency", () => {
  let app: INestApplication;
  let coldStartMs: number;

  beforeAll(async () => {
    const start = process.hrtime.bigint();
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    const end = process.hrtime.bigint();
    coldStartMs = Number(end - start) / 1_000_000;
  });

  afterAll(async () => {
    await app.close();
  });

  it("cold start is under 5 seconds (SC.BOOT.01 / SC.PERF.01)", () => {
    expect(coldStartMs).toBeLessThan(COLD_START_BUDGET_MS);
  });

  it("median /health/live latency is under 50ms (SC.BOOT.02 / SC.PERF.02)", async () => {
    const samples: number[] = [];
    // Discard the first call — its duration absorbs JIT + first-route lookup.
    await request(app.getHttpServer()).get("/health/live").expect(200);

    for (let i = 0; i < HEALTH_PROBE_SAMPLE_SIZE; i++) {
      const start = process.hrtime.bigint();
      const response = await request(app.getHttpServer()).get("/health/live");
      const end = process.hrtime.bigint();
      expect(response.status).toBe(200);
      samples.push(Number(end - start) / 1_000_000);
    }
    const med = median(samples);
    expect(med).toBeLessThan(HEALTH_LIVE_BUDGET_MS);
  });
});
