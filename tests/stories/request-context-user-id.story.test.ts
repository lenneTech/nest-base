import { describe, expect, it } from "vitest";

import {
  getCurrentUserId,
  runWithRequestContext,
  setCurrentUserId,
} from "../../src/core/request-context/request-context.js";

/**
 * Story · Request-Context userId
 *
 * `getCurrentUserId()` reads the authenticated user id that
 * `BetterAuthSessionMiddleware` stamps on the running context via
 * `setCurrentUserId()`. Services that need the caller's id can read it
 * without it being threaded through every parameter list.
 */
describe("Story · Request-Context userId", () => {
  it("returns undefined outside any request context", () => {
    expect(getCurrentUserId()).toBeUndefined();
  });

  it("returns undefined when no userId has been set on the context", async () => {
    const result = await runWithRequestContext(
      { requestId: "req-1", traceId: "t1", parentId: "p1", sampled: false },
      async () => getCurrentUserId(),
    );
    expect(result).toBeUndefined();
  });

  it("returns the userId after setCurrentUserId() is called inside the context", async () => {
    const userId = "user-abc-123";
    const result = await runWithRequestContext(
      { requestId: "req-2", traceId: "t2", parentId: "p2", sampled: false },
      async () => {
        setCurrentUserId(userId);
        return getCurrentUserId();
      },
    );
    expect(result).toBe(userId);
  });

  it("setCurrentUserId(undefined) is a no-op — userId stays unset", async () => {
    const result = await runWithRequestContext(
      { requestId: "req-3", traceId: "t3", parentId: "p3", sampled: false },
      async () => {
        setCurrentUserId(undefined);
        return getCurrentUserId();
      },
    );
    // Calling setCurrentUserId(undefined) must not overwrite the field with
    // undefined — leaving it unset is the desired state for anonymous requests.
    expect(result).toBeUndefined();
  });

  it("isolates userId across concurrent contexts", async () => {
    const a = runWithRequestContext(
      { requestId: "A", traceId: "ta", parentId: "pa", sampled: false },
      async () => {
        setCurrentUserId("user-A");
        await new Promise((r) => setTimeout(r, 5));
        return getCurrentUserId();
      },
    );
    const b = runWithRequestContext(
      { requestId: "B", traceId: "tb", parentId: "pb", sampled: false },
      async () => {
        setCurrentUserId("user-B");
        await new Promise((r) => setTimeout(r, 1));
        return getCurrentUserId();
      },
    );
    const [aResult, bResult] = await Promise.all([a, b]);
    expect(aResult).toBe("user-A");
    expect(bResult).toBe("user-B");
  });
});
