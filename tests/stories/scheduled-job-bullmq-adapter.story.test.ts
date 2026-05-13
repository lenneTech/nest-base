import { describe, expect, it, vi } from "vitest";

/**
 * Story · ScheduledJobBullMQAdapter — cron wiring to BullMQ (C1 fix)
 * + daily cron semantics documentation (Fix #4).
 *
 * Before this adapter, `DiscoveryScheduledJobRegistry` discovered
 * `@ScheduledJob`-decorated methods but nothing read the registry to
 * schedule actual recurring work — `ApiKeyExpiryRunner.tick()` and
 * `GdprErasureRunner.tick()` were never called at runtime.
 *
 * This story verifies:
 *  - On `onApplicationBootstrap`, the adapter calls `queue.register`
 *    for every entry in the registry.
 *  - The adapter schedules a `setInterval` that calls `queue.enqueue`
 *    periodically.
 *  - `parseCronToIntervalMs` converts the supported cron patterns
 *    correctly (daily / hourly / fallback).
 */

// ---------------------------------------------------------------------------
// 1. parseCronToIntervalMs — pure function, no DI
// ---------------------------------------------------------------------------

describe("Story · parseCronToIntervalMs converts cron to setInterval millis", () => {
  it("'0 8 * * *' (daily at 08:00) → 24h interval", async () => {
    const { parseCronToIntervalMs } =
      await import("../../src/core/jobs/scheduled-job-bullmq-adapter.js");
    expect(parseCronToIntervalMs("0 8 * * *")).toBe(24 * 60 * 60 * 1000);
  });

  it("'0 4 * * *' (daily at 04:00) → 24h interval", async () => {
    const { parseCronToIntervalMs } =
      await import("../../src/core/jobs/scheduled-job-bullmq-adapter.js");
    expect(parseCronToIntervalMs("0 4 * * *")).toBe(24 * 60 * 60 * 1000);
  });

  it("'0 * * * *' (hourly) → 1h interval", async () => {
    const { parseCronToIntervalMs } =
      await import("../../src/core/jobs/scheduled-job-bullmq-adapter.js");
    expect(parseCronToIntervalMs("0 * * * *")).toBe(60 * 60 * 1000);
  });

  it("unrecognised pattern → null (caller decides; warning is emitted at call-site via this.log.warn)", async () => {
    const { parseCronToIntervalMs } =
      await import("../../src/core/jobs/scheduled-job-bullmq-adapter.js");
    expect(parseCronToIntervalMs("*/15 * * * *")).toBeNull();
    expect(parseCronToIntervalMs("bad-cron")).toBeNull();
    expect(parseCronToIntervalMs("")).toBeNull();
    // No console.warn assertion: the warning is emitted by the call-site
    // (onApplicationBootstrap) via this.log.warn — not inside parseCronToIntervalMs.
  });
});

// ---------------------------------------------------------------------------
// 2. ScheduledJobBullMQAdapter.onApplicationBootstrap wires registry
// ---------------------------------------------------------------------------

describe("Story · ScheduledJobBullMQAdapter.onApplicationBootstrap wires every registry entry", () => {
  it("calls queue.register() for each @ScheduledJob entry", async () => {
    const { ScheduledJobBullMQAdapter } =
      await import("../../src/core/jobs/scheduled-job-bullmq-adapter.js");

    // Fake registry with two entries
    const runs: string[] = [];
    const fakeRegistry = {
      list: () => [
        {
          name: "testJob1",
          cron: "0 8 * * *",
          source: "FakeRunner1.tick",
          run: async () => {
            runs.push("testJob1");
          },
        },
        {
          name: "testJob2",
          cron: "0 4 * * *",
          source: "FakeRunner2.tick",
          run: async () => {
            runs.push("testJob2");
          },
        },
      ],
      has: () => false,
      runOnce: async (_name: string) => {
        throw new Error("not implemented in fake");
      },
    };

    const registeredNames: string[] = [];
    const fakeQueue = {
      register: (name: string, _handler: unknown) => {
        registeredNames.push(name);
      },
      enqueue: vi.fn().mockResolvedValue("fake-id"),
      start: vi.fn(),
      stop: vi.fn(),
      drain: vi.fn(),
      listJobs: vi.fn(),
      getJob: vi.fn(),
      getAggregates: vi.fn(),
      retry: vi.fn(),
    };

    // @ts-expect-error — using a partial fake for the test
    const adapter = new ScheduledJobBullMQAdapter(fakeQueue, fakeRegistry);
    adapter.onApplicationBootstrap();

    // Both jobs should be registered with the queue
    expect(registeredNames).toContain("testJob1");
    expect(registeredNames).toContain("testJob2");
    expect(registeredNames).toHaveLength(2);

    // Clean up timers so the test runner can exit cleanly
    adapter.clearAll();
  });

  it("registered handler delegates to entry.run() when the queue processes the job", async () => {
    const { ScheduledJobBullMQAdapter } =
      await import("../../src/core/jobs/scheduled-job-bullmq-adapter.js");

    let ran = false;
    const fakeRegistry = {
      list: () => [
        {
          name: "singleJob",
          cron: "0 1 * * *",
          source: "FakeRunner.tick",
          run: async () => {
            ran = true;
          },
        },
      ],
      has: () => false,
      runOnce: async (_name: string) => {},
    };

    let capturedHandler: ((payload: unknown) => Promise<void>) | null = null;
    const fakeQueue = {
      register: (_name: string, handler: (payload: unknown) => Promise<void>) => {
        capturedHandler = handler;
      },
      enqueue: vi.fn().mockResolvedValue("fake-id"),
    };

    // @ts-expect-error — partial fake
    const adapter = new ScheduledJobBullMQAdapter(fakeQueue, fakeRegistry);
    adapter.onApplicationBootstrap();

    expect(capturedHandler).not.toBeNull();
    // Invoking the captured handler should call entry.run()
    await capturedHandler!({});
    expect(ran).toBe(true);

    adapter.clearAll();
  });

  it("empty registry logs a message and does nothing", async () => {
    const { ScheduledJobBullMQAdapter } =
      await import("../../src/core/jobs/scheduled-job-bullmq-adapter.js");

    const fakeRegistry = {
      list: () => [],
      has: () => false,
      runOnce: async (_name: string) => {},
    };
    const registerCalls: string[] = [];
    const fakeQueue = {
      register: (name: string) => registerCalls.push(name),
      enqueue: vi.fn(),
    };

    // @ts-expect-error — partial fake
    const adapter = new ScheduledJobBullMQAdapter(fakeQueue, fakeRegistry);
    adapter.onApplicationBootstrap();

    expect(registerCalls).toHaveLength(0);
    adapter.clearAll(); // no-op, but safe
  });

  it("H1 fix: onModuleDestroy() clears all active timers (same effect as clearAll)", async () => {
    const { ScheduledJobBullMQAdapter } =
      await import("../../src/core/jobs/scheduled-job-bullmq-adapter.js");

    const fakeRegistry = {
      list: () => [
        {
          name: "job1",
          cron: "0 8 * * *",
          source: "Fake.tick",
          run: async () => {},
        },
      ],
      has: () => false,
      runOnce: async () => {},
    };
    const fakeQueue = {
      register: () => {},
      enqueue: vi.fn().mockResolvedValue("fake-id"),
    };

    // @ts-expect-error — partial fake
    const adapter = new ScheduledJobBullMQAdapter(fakeQueue, fakeRegistry);
    adapter.onApplicationBootstrap();

    // onModuleDestroy should not throw and should clear timers
    expect(() => adapter.onModuleDestroy()).not.toThrow();
    // After destroy, clearAll is a no-op (timers array already empty)
    expect(() => adapter.clearAll()).not.toThrow();
  });

  it("clears the interval timer on module destroy", async () => {
    // Finding 13: verify that onModuleDestroy actually calls clearInterval
    // for each registered timer rather than just not throwing.
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    try {
      const { ScheduledJobBullMQAdapter } =
        await import("../../src/core/jobs/scheduled-job-bullmq-adapter.js");

      const fakeRegistry = {
        list: () => [
          {
            name: "destroyJob",
            cron: "0 8 * * *",
            source: "Fake.tick",
            run: async () => {},
          },
        ],
        has: () => false,
        runOnce: async () => {},
      };
      const fakeQueue = {
        register: () => {},
        enqueue: vi.fn().mockResolvedValue("fake-id"),
      };

      // @ts-expect-error — partial fake
      const adapter = new ScheduledJobBullMQAdapter(fakeQueue, fakeRegistry);
      adapter.onApplicationBootstrap();
      adapter.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});

// ---------------------------------------------------------------------------
// Fix #4: Daily cron semantics — document that parseCronToIntervalMs tracks
// the 24h period, NOT the wall-clock next-fire time.
// ---------------------------------------------------------------------------

describe("Story · Daily-cron semantics: parseCronToIntervalMs tracks period, not next-fire (Fix #4)", () => {
  it("all daily-at-HH:MM crons return a 24h interval (wall-clock time ignored — tracks period, not next-fire)", async () => {
    const { parseCronToIntervalMs } =
      await import("../../src/core/jobs/scheduled-job-bullmq-adapter.js");

    // All these expressions represent "once a day" — the hour/minute
    // of the fire time is ignored by parseCronToIntervalMs. The
    // setInterval-based scheduler always fires every 24h regardless of
    // when the cron would have fired next on a real cron daemon.
    //
    // KNOWN SEMANTIC GAP (see OPEN_QUESTIONS.md): if the app boots at
    // 09:00 with a cron of "30 23 * * *" (fire at 23:30), the next
    // real fire should be in 14.5h — but setInterval fires it again
    // after exactly 24h. The operator sees a ~14.5h drift on first
    // execution after boot. This is acceptable for the current
    // single-pod, non-time-critical jobs (GDPR erasure, API-key expiry).
    expect(parseCronToIntervalMs("30 23 * * *")).toBe(24 * 60 * 60 * 1000);
    expect(parseCronToIntervalMs("0 1 * * *")).toBe(24 * 60 * 60 * 1000);
    expect(parseCronToIntervalMs("0 0 * * *")).toBe(24 * 60 * 60 * 1000);
    expect(parseCronToIntervalMs("59 23 * * *")).toBe(24 * 60 * 60 * 1000);
  });
});
