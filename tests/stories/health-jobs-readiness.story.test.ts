import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · /health/ready must observe BullMQ worker registration (CRIT-1).
 *
 * Without JobsModule imported into HealthModule, `jobQueue` stays
 * undefined and worker failures never surface on the readiness probe —
 * setup-smoke stayed green while local `bun run dev` logged registration
 * errors.
 */
describe("Story · Health readiness includes BullMQ worker health", () => {
  it("HealthModule imports JobsModule so HealthService can inject BullMQJobQueue", () => {
    const src = readFileSync(resolve(ROOT, "src/core/health/health.module.ts"), "utf8");
    expect(src).toMatch(/imports:\s*\[[^\]]*JobsModule/s);
  });

  it("JobsModule exports the BullMQJobQueue token (not only JobQueueService)", () => {
    const src = readFileSync(resolve(ROOT, "src/core/jobs/jobs.module.ts"), "utf8");
    expect(src).toMatch(/exports:\s*\[[^\]]*BullMQJobQueue/s);
  });

  it("HealthService value-imports BullMQJobQueue so Nest DI emits the class token", () => {
    const src = readFileSync(resolve(ROOT, "src/core/health/health.service.ts"), "utf8");
    expect(src).toMatch(/import \{ BullMQJobQueue \} from/);
    expect(src).not.toMatch(/import type \{ BullMQJobQueue \}/);
  });

  it("HealthService readiness() consults jobQueue.isReady() when the queue is wired", () => {
    const src = readFileSync(resolve(ROOT, "src/core/health/health.service.ts"), "utf8");
    expect(src).toMatch(/isReady\(\)/);
    expect(src).toMatch(/checks\.jobs/);
  });
});
