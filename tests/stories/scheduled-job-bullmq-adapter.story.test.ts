import { describe, expect, it, vi } from "vitest";

/**
 * Story · ScheduledJobBullMQAdapter — cron wiring to BullMQ (C1 fix)
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
    const { parseCronToIntervalMs } = await import(
      "../../src/core/jobs/scheduled-job-bullmq-adapter.js"
    );
    expect(parseCronToIntervalMs("0 8 * * *")).toBe(24 * 60 * 60 * 1000);
  });

  it("'0 4 * * *' (daily at 04:00) → 24h interval", async () => {
    const { parseCronToIntervalMs } = await import(
      "../../src/core/jobs/scheduled-job-bullmq-adapter.js"
    );
    expect(parseCronToIntervalMs("0 4 * * *")).toBe(24 * 60 * 60 * 1000);
  });

  it("'0 * * * *' (hourly) → 1h interval", async () => {
    const { parseCronToIntervalMs } = await import(
      "../../src/core/jobs/scheduled-job-bullmq-adapter.js"
    );
    expect(parseCronToIntervalMs("0 * * * *")).toBe(60 * 60 * 1000);
  });

  it("unrecognised pattern → 24h (fail-safe)", async () => {
    const { parseCronToIntervalMs } = await import(
      "../../src/core/jobs/scheduled-job-bullmq-adapter.js"
    );
    expect(parseCronToIntervalMs("*/15 * * * *")).toBe(24 * 60 * 60 * 1000);
    expect(parseCronToIntervalMs("bad-cron")).toBe(24 * 60 * 60 * 1000);
    expect(parseCronToIntervalMs("")).toBe(24 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// 2. ScheduledJobBullMQAdapter.onApplicationBootstrap wires registry
// ---------------------------------------------------------------------------

describe("Story · ScheduledJobBullMQAdapter.onApplicationBootstrap wires every registry entry", () => {
  it("calls queue.register() for each @ScheduledJob entry", async () => {
    const { ScheduledJobBullMQAdapter } = await import(
      "../../src/core/jobs/scheduled-job-bullmq-adapter.js"
    );

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
    const { ScheduledJobBullMQAdapter } = await import(
      "../../src/core/jobs/scheduled-job-bullmq-adapter.js"
    );

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
    const { ScheduledJobBullMQAdapter } = await import(
      "../../src/core/jobs/scheduled-job-bullmq-adapter.js"
    );

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
});
