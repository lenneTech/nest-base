/**
 * Story: rate-limit-decision-planner
 *
 * Covers the pure-planner surface for RateLimitDecision:
 *   - `shouldSampleDecision` — block decisions always sampled; allow sampled ~1%
 *   - `buildDecisionRecord` — produces correct shape
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDecisionRecord,
  shouldSampleDecision,
} from "../../src/core/throttler/rate-limit-decision-planner.js";

describe("shouldSampleDecision", () => {
  it("always returns true for block decisions", () => {
    // Run 20 times with varied random values — must always be true
    for (let i = 0; i < 20; i++) {
      expect(shouldSampleDecision("block")).toBe(true);
    }
  });

  it("returns true for allow decisions when Math.random() < 0.01", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.005);
    expect(shouldSampleDecision("allow")).toBe(true);
    spy.mockRestore();
  });

  it("returns false for allow decisions when Math.random() >= 0.01", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.02);
    expect(shouldSampleDecision("allow")).toBe(false);
    spy.mockRestore();
  });

  it("returns false for allow decisions at the boundary (0.01)", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.01);
    expect(shouldSampleDecision("allow")).toBe(false);
    spy.mockRestore();
  });

  it("allow decisions sample at roughly 1% with 10000 draws", () => {
    // Restore real Math.random for this statistical test
    const samples = Array.from({ length: 10_000 }, () => shouldSampleDecision("allow"));
    const trueCount = samples.filter(Boolean).length;
    // Expect between 0.5% and 2% (generous range for CI stability)
    expect(trueCount).toBeGreaterThanOrEqual(50);
    expect(trueCount).toBeLessThanOrEqual(200);
  });
});

describe("buildDecisionRecord", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces correct shape for a block decision", () => {
    const record = buildDecisionRecord({
      bucketKey: "ip::192.168.1.1::auth:signIn",
      endpoint: "auth:signIn",
      decision: "block",
      count: 6,
      limit: 5,
      windowSecs: 60,
      ip: "192.168.1.1",
      userId: undefined,
    });

    expect(record.bucketKey).toBe("ip::192.168.1.1::auth:signIn");
    expect(record.endpoint).toBe("auth:signIn");
    expect(record.decision).toBe("block");
    expect(record.count).toBe(6);
    expect(record.limit).toBe(5);
    expect(record.windowSecs).toBe(60);
    expect(record.ip).toBe("192.168.1.1");
    expect(record.userId).toBeUndefined();
    expect(record.ts).toBeInstanceOf(Date);
  });

  it("includes userId when provided", () => {
    const record = buildDecisionRecord({
      bucketKey: "user::abc123::global:1m",
      endpoint: "global:1m",
      decision: "allow",
      count: 10,
      limit: 300,
      windowSecs: 60,
      userId: "abc123",
    });

    expect(record.userId).toBe("abc123");
    expect(record.ip).toBeUndefined();
  });

  it("sets ts to current date", () => {
    const before = Date.now();
    const record = buildDecisionRecord({
      bucketKey: "test::key",
      endpoint: "global:1s",
      decision: "allow",
      count: 1,
      limit: 100,
      windowSecs: 1,
    });
    const after = Date.now();

    expect(record.ts.getTime()).toBeGreaterThanOrEqual(before);
    expect(record.ts.getTime()).toBeLessThanOrEqual(after);
  });
});
