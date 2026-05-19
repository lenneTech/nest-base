import { describe, expect, it } from "vitest";

import {
  GdprExportJobNotFoundError,
  GdprExportJobRegistry,
  type GdprExportJob,
} from "../../src/core/gdpr/gdpr-export.registry.js";

/**
 * Story · GDPR /me/export async export jobs (CF.GDPR.* — iter-96
 * review Finding 12).
 */
describe("Story · GdprExportJobRegistry", () => {
  it("enqueue() returns a fresh job in status PENDING", async () => {
    const registry = new GdprExportJobRegistry();
    const job = await registry.enqueue({ userId: "u-1", tenantId: "t-1" });
    expect(job.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(job.status).toBe("PENDING");
    expect(job.userId).toBe("u-1");
    expect(job.tenantId).toBe("t-1");
    expect(job.requestedAt).toBeInstanceOf(Date);
    expect(job.completedAt).toBeNull();
    expect(job.payload).toBeNull();
  });

  it("get() returns the same job object for an enqueued id", async () => {
    const registry = new GdprExportJobRegistry();
    const job = await registry.enqueue({ userId: "u-1", tenantId: null });
    const fetched = await registry.get(job.id);
    expect(fetched?.id).toBe(job.id);
    expect(fetched?.status).toBe("PENDING");
  });

  it("get() returns null for unknown ids", async () => {
    const registry = new GdprExportJobRegistry();
    expect(await registry.get("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("complete() transitions PENDING → COMPLETED with payload", async () => {
    const registry = new GdprExportJobRegistry();
    const job = await registry.enqueue({ userId: "u-1", tenantId: null });
    const payload = { user: { id: "u-1" }, exportedAt: new Date().toISOString() };
    await registry.complete(job.id, payload);
    const fetched = await registry.get(job.id);
    expect(fetched?.status).toBe("COMPLETED");
    expect(fetched?.completedAt).toBeInstanceOf(Date);
    expect(fetched?.payload).toEqual(payload);
  });

  it("fail() transitions to FAILED with an error message", async () => {
    const registry = new GdprExportJobRegistry();
    const job = await registry.enqueue({ userId: "u-1", tenantId: null });
    await registry.fail(job.id, new Error("kaboom"));
    const fetched = await registry.get(job.id);
    expect(fetched?.status).toBe("FAILED");
    expect(fetched?.error).toBe("kaboom");
  });

  it("complete() / fail() throw on unknown ids", async () => {
    const registry = new GdprExportJobRegistry();
    await expect(
      registry.complete("00000000-0000-0000-0000-000000000000", {}),
    ).rejects.toThrow(GdprExportJobNotFoundError);
    await expect(
      registry.fail("00000000-0000-0000-0000-000000000000", new Error()),
    ).rejects.toThrow(GdprExportJobNotFoundError);
  });

  it("complete() is idempotent — second call on an already-completed job is a no-op", async () => {
    const registry = new GdprExportJobRegistry();
    const job = await registry.enqueue({ userId: "u-1", tenantId: null });
    await registry.complete(job.id, { first: true });
    await registry.complete(job.id, { second: true });
    const fetched = await registry.get(job.id);
    expect(fetched?.payload).toEqual({ first: true });
  });

  it("isolates per-user jobs (listForUser)", async () => {
    const registry = new GdprExportJobRegistry();
    await registry.enqueue({ userId: "u-1", tenantId: null });
    await registry.enqueue({ userId: "u-1", tenantId: null });
    await registry.enqueue({ userId: "u-2", tenantId: null });
    const u1Jobs: readonly GdprExportJob[] = await registry.listForUser("u-1");
    expect(u1Jobs).toHaveLength(2);
    expect(u1Jobs.every((j) => j.userId === "u-1")).toBe(true);
  });
});
