import { describe, expect, it } from "vitest";

import {
  buildDevSessionRefreshState,
  defaultDevSessionState,
  parseDevSessionState,
  planDevSessionStart,
  planDevSessionTransition,
  serializeDevSessionState,
} from "../../src/core/dx/dev-session.js";

/**
 * Story · Dev-Session lock.
 *
 * `scripts/dev.ts` writes a small JSON lock file at startup that
 * `bootstrap.ts` reads on every (re-)init. The lock survives
 * `bun --watch` re-execs (which would otherwise reset
 * `process.env.DEV_HUB_OPENED`), so:
 *
 *   - The Dev Hub browser tab opens **once** per dev session, not on
 *     every code save.
 *   - The startup banner can report "♻ restarted (code change)" vs
 *     the full hero banner depending on the lock state.
 *
 * Pure planner; the runner side (file IO + lifetime) lives in
 * `dev-session-runner.ts`.
 */
describe("Story · Dev-Session lock", () => {
  it("default state has no opened flag and reason 'initial'", () => {
    const state = defaultDevSessionState();
    expect(state.devHubOpened).toBe(false);
    expect(state.lastReason).toBe("initial");
    expect(typeof state.sessionId).toBe("string");
    expect(state.sessionId.length).toBeGreaterThan(0);
  });

  describe("planDevSessionStart", () => {
    it("returns a fresh state when no existing lock exists (cold boot)", () => {
      const plan = planDevSessionStart({ existing: null, now: 1730000000000 });
      expect(plan.action).toBe("write");
      expect(plan.state.devHubOpened).toBe(false);
      expect(plan.state.lastReason).toBe("initial");
      expect(plan.state.startedAtMs).toBe(1730000000000);
    });

    it("ignores a stale existing lock (different sessionId is overwritten)", () => {
      const existing = { ...defaultDevSessionState(), sessionId: "old", devHubOpened: true };
      const plan = planDevSessionStart({ existing, now: 1730000000000 });
      expect(plan.action).toBe("write");
      expect(plan.state.sessionId).not.toBe("old");
      expect(plan.state.devHubOpened).toBe(false);
    });
  });

  describe("planDevSessionTransition (read-and-update from bootstrap)", () => {
    it("first init in this session ⇒ open browser, mark devHubOpened=true", () => {
      const before = defaultDevSessionState();
      const plan = planDevSessionTransition({ existing: before });
      expect(plan.shouldOpenBrowser).toBe(true);
      expect(plan.bannerVariant).toBe("hero");
      expect(plan.next.devHubOpened).toBe(true);
    });

    it("subsequent init (watch reload) ⇒ skip browser, compact restart banner", () => {
      const before = {
        ...defaultDevSessionState(),
        devHubOpened: true,
        lastReason: "watch" as const,
      };
      const plan = planDevSessionTransition({ existing: before });
      expect(plan.shouldOpenBrowser).toBe(false);
      expect(plan.bannerVariant).toBe("restart-watch");
      expect(plan.next.devHubOpened).toBe(true);
    });

    it("subsequent init after .env change ⇒ skip browser, env-change banner", () => {
      const before = {
        ...defaultDevSessionState(),
        devHubOpened: true,
        lastReason: "env-change" as const,
      };
      const plan = planDevSessionTransition({ existing: before });
      expect(plan.shouldOpenBrowser).toBe(false);
      expect(plan.bannerVariant).toBe("restart-env");
      // After bootstrap consumes the env-change reason, it returns to
      // 'watch' so the next plain code-save shows the watch banner.
      expect(plan.next.lastReason).toBe("watch");
    });

    it("missing lock file ⇒ treated as initial boot (graceful: dev runner may have crashed)", () => {
      const plan = planDevSessionTransition({ existing: null });
      expect(plan.shouldOpenBrowser).toBe(true);
      expect(plan.bannerVariant).toBe("hero");
    });
  });

  describe("buildDevSessionRefreshState (env-change marker from dev runner)", () => {
    it("preserves sessionId + devHubOpened, sets reason to 'env-change'", () => {
      const before = {
        ...defaultDevSessionState(),
        sessionId: "session-xyz",
        devHubOpened: true,
        lastReason: "watch" as const,
      };
      const next = buildDevSessionRefreshState({ existing: before, reason: "env-change" });
      expect(next.sessionId).toBe("session-xyz");
      expect(next.devHubOpened).toBe(true);
      expect(next.lastReason).toBe("env-change");
    });
  });

  describe("serialize / parse", () => {
    it("round-trips through JSON", () => {
      const original = {
        sessionId: "abc123",
        startedAtMs: 1700000000000,
        devHubOpened: true,
        lastReason: "watch" as const,
      };
      const json = serializeDevSessionState(original);
      const parsed = parseDevSessionState(json);
      expect(parsed).toEqual(original);
    });

    it("returns null on malformed JSON", () => {
      expect(parseDevSessionState("not-json")).toBeNull();
      expect(parseDevSessionState('{"sessionId":42}')).toBeNull();
    });

    it("returns null on missing required fields", () => {
      expect(parseDevSessionState("{}")).toBeNull();
      expect(parseDevSessionState('{"sessionId":"x"}')).toBeNull();
    });
  });
});
