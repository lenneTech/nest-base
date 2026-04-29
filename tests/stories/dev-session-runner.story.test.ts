import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearDevSessionState,
  devSessionLockPath,
  markDevSessionRefresh,
  readDevSessionState,
  startDevSession,
  transitionDevSession,
  writeDevSessionState,
} from "../../src/core/dx/dev-session-runner.js";

/**
 * Story · Dev-Session runner.
 *
 * Pure planner is covered by `dev-session.story.test.ts`. This story
 * exercises the file-IO wrapper end-to-end against a real (temp)
 * project root: writes the lock at startup, advances state on
 * bootstrap, marks `.env` reasons, and clears on shutdown.
 */
describe("Story · Dev-Session runner (file IO)", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "dev-session-test-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("startDevSession writes a fresh lock under node_modules/.cache/", () => {
    const state = startDevSession(projectRoot);
    const path = devSessionLockPath(projectRoot);
    expect(existsSync(path)).toBe(true);
    expect(state.devHubOpened).toBe(false);
    expect(state.lastReason).toBe("initial");
    const persisted = readDevSessionState(projectRoot);
    expect(persisted?.sessionId).toBe(state.sessionId);
  });

  it("startDevSession overwrites a stale lock (defensive against crashed prior runs)", () => {
    // First run leaves lock with devHubOpened=true.
    startDevSession(projectRoot);
    const t1 = transitionDevSession(projectRoot);
    expect(t1.state.devHubOpened).toBe(true);
    // New `bun run dev` starts fresh — must NOT inherit devHubOpened.
    const next = startDevSession(projectRoot);
    expect(next.devHubOpened).toBe(false);
    expect(next.sessionId).not.toBe(t1.state.sessionId);
  });

  it("transitionDevSession opens the browser only on the first init of the session", () => {
    startDevSession(projectRoot);

    const first = transitionDevSession(projectRoot);
    expect(first.shouldOpenBrowser).toBe(true);
    expect(first.bannerVariant).toBe("hero");

    const second = transitionDevSession(projectRoot);
    expect(second.shouldOpenBrowser).toBe(false);
    expect(second.bannerVariant).toBe("restart-watch");

    const third = transitionDevSession(projectRoot);
    expect(third.shouldOpenBrowser).toBe(false);
    expect(third.bannerVariant).toBe("restart-watch");
  });

  it("markDevSessionRefresh + transition surfaces the env-change banner exactly once", () => {
    startDevSession(projectRoot);
    transitionDevSession(projectRoot); // first init

    markDevSessionRefresh(projectRoot, "env-change");
    const afterEnv = transitionDevSession(projectRoot);
    expect(afterEnv.bannerVariant).toBe("restart-env");

    // Subsequent watch reload should fall back to plain "code change".
    const afterCode = transitionDevSession(projectRoot);
    expect(afterCode.bannerVariant).toBe("restart-watch");
  });

  it("transitionDevSession with no lock falls back to the hero banner (graceful)", () => {
    const t = transitionDevSession(projectRoot);
    expect(t.shouldOpenBrowser).toBe(true);
    expect(t.bannerVariant).toBe("hero");
  });

  it("clearDevSessionState removes the lock (called by dev runner on shutdown)", () => {
    startDevSession(projectRoot);
    expect(existsSync(devSessionLockPath(projectRoot))).toBe(true);
    clearDevSessionState(projectRoot);
    expect(existsSync(devSessionLockPath(projectRoot))).toBe(false);
    // Idempotent — calling on a missing file does not throw.
    clearDevSessionState(projectRoot);
  });

  it("readDevSessionState returns null on malformed lock content", () => {
    const path = devSessionLockPath(projectRoot);
    writeDevSessionState(projectRoot, {
      sessionId: "x",
      startedAtMs: 1,
      devHubOpened: false,
      lastReason: "initial",
    });
    // Corrupt the file.
    writeFileSync(path, "not json", "utf8");
    expect(readDevSessionState(projectRoot)).toBeNull();
  });

  it("markDevSessionRefresh on a missing lock is a no-op (no crash)", () => {
    expect(() => markDevSessionRefresh(projectRoot, "env-change")).not.toThrow();
    expect(readDevSessionState(projectRoot)).toBeNull();
  });

  it("written file is well-formed JSON (consumable by future bootstrap reads)", () => {
    const state = startDevSession(projectRoot);
    const raw = readFileSync(devSessionLockPath(projectRoot), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.sessionId).toBe(state.sessionId);
    expect(parsed.devHubOpened).toBe(false);
  });
});
