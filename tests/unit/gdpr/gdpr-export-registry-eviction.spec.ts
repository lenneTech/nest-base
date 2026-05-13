import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GdprExportJobRegistry } from "../../../src/core/gdpr/gdpr-export.registry.js";

/**
 * Unit test — GDPR export registry eviction timer (M7).
 *
 * The in-memory registry previously held completed/failed jobs forever,
 * causing unbounded heap growth under sustained load. After the fix,
 * terminal jobs are evicted after 24 h via setTimeout.
 */
describe("GdprExportJobRegistry · eviction timer (M7)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("completed job is evicted from the Map after 24 h", () => {
    const registry = new GdprExportJobRegistry();
    const job = registry.enqueue({ userId: "u1", tenantId: "t1" });
    registry.start(job.id);
    registry.complete(job.id, { data: "export" });

    // Immediately after completion the job is still readable.
    expect(registry.get(job.id)).not.toBeNull();

    // Advance the fake clock past 24 h — the setTimeout fires and deletes it.
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(registry.get(job.id)).toBeNull();
  });

  it("failed job is evicted from the Map after 24 h", () => {
    const registry = new GdprExportJobRegistry();
    const job = registry.enqueue({ userId: "u2", tenantId: "t2" });
    registry.start(job.id);
    registry.fail(job.id, new Error("synthesizer failed"));

    expect(registry.get(job.id)).not.toBeNull();

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(registry.get(job.id)).toBeNull();
  });

  it("pending/running jobs are not evicted prematurely", () => {
    const registry = new GdprExportJobRegistry();
    const job = registry.enqueue({ userId: "u3", tenantId: null });
    registry.start(job.id);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    // Still running — no eviction timer was set.
    expect(registry.get(job.id)).not.toBeNull();
  });
});

/**
 * Unit · GdprExportJobRegistry — stale-job sweep (Fix 3.3)
 *
 * Ensures that PENDING/RUNNING jobs older than 2 h are marked FAILED
 * by the periodic sweep so the registry doesn't accumulate zombie entries
 * after pod crashes or lost context.
 */
describe("GdprExportJobRegistry — stale-job sweep", () => {
  let registry: GdprExportJobRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new GdprExportJobRegistry();
    // Trigger onModuleInit manually (NestJS lifecycle in DI, not called in tests)
    registry.onModuleInit();
  });

  afterEach(() => {
    registry.onModuleDestroy();
    vi.useRealTimers();
  });

  it("marks a PENDING job as FAILED after the stale threshold passes", () => {
    const job = registry.enqueue({ userId: "u1", tenantId: "t1" });
    expect(job.status).toBe("PENDING");

    // Advance time past the 2-hour stale threshold + one sweep interval
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 10 * 60 * 1000 + 1);

    const updated = registry.get(job.id);
    expect(updated?.status).toBe("FAILED");
    expect(updated?.error).toMatch(/stale/i);
  });

  it("marks a RUNNING job as FAILED after the stale threshold passes", () => {
    const job = registry.enqueue({ userId: "u2", tenantId: "t2" });
    registry.start(job.id);
    expect(registry.get(job.id)?.status).toBe("RUNNING");

    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 10 * 60 * 1000 + 1);

    const updated = registry.get(job.id);
    expect(updated?.status).toBe("FAILED");
  });

  it("does not mark a recently enqueued job as FAILED", () => {
    const job = registry.enqueue({ userId: "u3", tenantId: "t3" });
    // Only advance 1 sweep interval — not yet past the 2-hour threshold
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);

    const updated = registry.get(job.id);
    expect(updated?.status).toBe("PENDING");
  });
});
