import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GdprExportJobRegistry } from "../../../src/core/gdpr/gdpr-export.registry.js";

describe("GdprExportJobRegistry · eviction timer (M7)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("completed job is evicted from the Map after 24 h", async () => {
    const registry = new GdprExportJobRegistry();
    const job = await registry.enqueue({ userId: "u1", tenantId: "t1" });
    await registry.start(job.id);
    await registry.complete(job.id, { data: "export" });

    expect(await registry.get(job.id)).not.toBeNull();

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(await registry.get(job.id)).toBeNull();
  });

  it("failed job is evicted from the Map after 24 h", async () => {
    const registry = new GdprExportJobRegistry();
    const job = await registry.enqueue({ userId: "u2", tenantId: "t2" });
    await registry.start(job.id);
    await registry.fail(job.id, new Error("synthesizer failed"));

    expect(await registry.get(job.id)).not.toBeNull();

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(await registry.get(job.id)).toBeNull();
  });

  it("pending/running jobs are not evicted prematurely", async () => {
    const registry = new GdprExportJobRegistry();
    const job = await registry.enqueue({ userId: "u3", tenantId: null });
    await registry.start(job.id);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(await registry.get(job.id)).not.toBeNull();
  });
});

describe("GdprExportJobRegistry — stale-job sweep", () => {
  let registry: GdprExportJobRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new GdprExportJobRegistry();
    registry.onModuleInit();
  });

  afterEach(() => {
    registry.onModuleDestroy();
    vi.useRealTimers();
  });

  it("marks a PENDING job as FAILED after the stale threshold passes", async () => {
    const job = await registry.enqueue({ userId: "u1", tenantId: "t1" });
    expect(job.status).toBe("PENDING");

    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 10 * 60 * 1000 + 1);

    const updated = await registry.get(job.id);
    expect(updated?.status).toBe("FAILED");
    expect(updated?.error).toMatch(/stale/i);
  });

  it("marks a RUNNING job as FAILED after the stale threshold passes", async () => {
    const job = await registry.enqueue({ userId: "u2", tenantId: "t2" });
    await registry.start(job.id);
    expect((await registry.get(job.id))?.status).toBe("RUNNING");

    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 10 * 60 * 1000 + 1);

    const updated = await registry.get(job.id);
    expect(updated?.status).toBe("FAILED");
  });

  it("does not mark a recently enqueued job as FAILED", async () => {
    const job = await registry.enqueue({ userId: "u3", tenantId: "t3" });
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);

    const updated = await registry.get(job.id);
    expect(updated?.status).toBe("PENDING");
  });
});
