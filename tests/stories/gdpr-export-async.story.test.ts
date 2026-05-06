import { describe, expect, it } from "vitest";

import {
  GdprExportJobNotFoundError,
  GdprExportJobRegistry,
  type GdprExportJob,
} from "../../src/core/gdpr/gdpr-export.registry.js";

/**
 * Story · GDPR /me/export async export jobs (CF.GDPR.* — iter-96
 * review Finding 12).
 *
 * The PRD pins "/me/export async export jobs" — the synchronous
 * inline payload is replaced with an enqueue-and-poll surface:
 *   - POST  /me/export             → enqueue, returns {jobId}
 *   - GET   /me/export/:jobId      → status + payload (when ready)
 *
 * Iter-106 ships the `GdprExportJobRegistry` core: pure tracker for
 * async export jobs (PENDING / RUNNING / COMPLETED / FAILED). The
 * registry is in-memory by default; project bootstraps replace it
 * with a Prisma-backed adapter that persists artefacts under a
 * separate `gdpr_exports` table when long-lived job retention is
 * needed.
 */
describe("Story · GdprExportJobRegistry", () => {
  it("enqueue() returns a fresh job in status PENDING", () => {
    const registry = new GdprExportJobRegistry();
    const job = registry.enqueue({ userId: "u-1", tenantId: "t-1" });
    expect(job.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(job.status).toBe("PENDING");
    expect(job.userId).toBe("u-1");
    expect(job.tenantId).toBe("t-1");
    expect(job.requestedAt).toBeInstanceOf(Date);
    expect(job.completedAt).toBeNull();
    expect(job.payload).toBeNull();
  });

  it("get() returns the same job object for an enqueued id", () => {
    const registry = new GdprExportJobRegistry();
    const job = registry.enqueue({ userId: "u-1", tenantId: null });
    const fetched = registry.get(job.id);
    expect(fetched?.id).toBe(job.id);
    expect(fetched?.status).toBe("PENDING");
  });

  it("get() returns null for unknown ids", () => {
    const registry = new GdprExportJobRegistry();
    expect(registry.get("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("complete() transitions PENDING → COMPLETED with payload", () => {
    const registry = new GdprExportJobRegistry();
    const job = registry.enqueue({ userId: "u-1", tenantId: null });
    const payload = { user: { id: "u-1" }, exportedAt: new Date().toISOString() };
    registry.complete(job.id, payload);
    const fetched = registry.get(job.id);
    expect(fetched?.status).toBe("COMPLETED");
    expect(fetched?.completedAt).toBeInstanceOf(Date);
    expect(fetched?.payload).toEqual(payload);
  });

  it("fail() transitions to FAILED with an error message", () => {
    const registry = new GdprExportJobRegistry();
    const job = registry.enqueue({ userId: "u-1", tenantId: null });
    registry.fail(job.id, new Error("kaboom"));
    const fetched = registry.get(job.id);
    expect(fetched?.status).toBe("FAILED");
    expect(fetched?.error).toBe("kaboom");
  });

  it("complete() / fail() throw on unknown ids", () => {
    const registry = new GdprExportJobRegistry();
    expect(() => registry.complete("00000000-0000-0000-0000-000000000000", {})).toThrow(
      GdprExportJobNotFoundError,
    );
    expect(() => registry.fail("00000000-0000-0000-0000-000000000000", new Error())).toThrow(
      GdprExportJobNotFoundError,
    );
  });

  it("complete() is idempotent — second call on an already-completed job is a no-op", () => {
    const registry = new GdprExportJobRegistry();
    const job = registry.enqueue({ userId: "u-1", tenantId: null });
    registry.complete(job.id, { first: true });
    registry.complete(job.id, { second: true }); // ignored
    const fetched = registry.get(job.id);
    expect(fetched?.payload).toEqual({ first: true });
  });

  it("isolates per-user jobs (listForUser)", () => {
    const registry = new GdprExportJobRegistry();
    registry.enqueue({ userId: "u-1", tenantId: null });
    registry.enqueue({ userId: "u-1", tenantId: null });
    registry.enqueue({ userId: "u-2", tenantId: null });
    const u1Jobs: readonly GdprExportJob[] = registry.listForUser("u-1");
    expect(u1Jobs).toHaveLength(2);
    expect(u1Jobs.every((j) => j.userId === "u-1")).toBe(true);
  });
});
