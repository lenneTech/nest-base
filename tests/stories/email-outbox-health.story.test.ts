import { describe, expect, it } from "vitest";

import {
  EMAIL_OUTBOX_LAG_THRESHOLD_MS,
  classifyEmailOutboxLag,
} from "../../src/core/email/email-outbox-health.js";

/**
 * Story · Email-Outbox lag classifier.
 *
 * The readiness probe consults the lag classifier to decide whether
 * to flag the outbox subsystem as stalled. The classifier is pure
 * (no DB, no clock) so the storyline stays deterministic — the
 * caller passes the current oldestPendingAge value.
 */
describe("Story · Email-Outbox lag classifier", () => {
  it("returns ok when there are no pending records", () => {
    const r = classifyEmailOutboxLag({ pendingCount: 0, oldestAgeMs: 0 });
    expect(r.status).toBe("ok");
    expect(r.lagMs).toBe(0);
  });

  it("returns ok when lag is below threshold", () => {
    const r = classifyEmailOutboxLag({ pendingCount: 3, oldestAgeMs: 5_000 });
    expect(r.status).toBe("ok");
    expect(r.lagMs).toBe(5_000);
  });

  it("returns fail when oldestAgeMs exceeds the threshold", () => {
    const r = classifyEmailOutboxLag({
      pendingCount: 1,
      oldestAgeMs: EMAIL_OUTBOX_LAG_THRESHOLD_MS + 1,
    });
    expect(r.status).toBe("fail");
    expect(r.error).toMatch(/lag/i);
  });

  it("respects an explicit threshold override", () => {
    const r = classifyEmailOutboxLag({ pendingCount: 1, oldestAgeMs: 6_000, thresholdMs: 5_000 });
    expect(r.status).toBe("fail");
  });
});
