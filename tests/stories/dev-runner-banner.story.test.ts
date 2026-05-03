import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  planDevRunnerAction,
  type DevRunnerProbeResult,
} from "../../src/core/dev/dev-runner-planner.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const DEV_SCRIPT = readFileSync(resolve(REPO_ROOT, "scripts/dev.ts"), "utf8");

/**
 * Story · Dev-Runner — probe → action planner.
 *
 * Friction 2026-05-03 #14:36 (HIGH) + #14:42 (MEDIUM): when port 3000 is
 * occupied by a stale Nuxt dev process from a prior workspace, `bun run
 * dev` hangs after route registration without printing a listening line
 * and ultimately exits 144. The portless takeover probe `process.kill(
 * pid, 0)` thinks the holder is alive (it is — just not ours), so it
 * neither falls back to a free port nor fails loudly.
 *
 * The planner formalises four port-holder states and the action the
 * runner must take for each. Pure function — `(probeResult) → action`
 * — kept separate from the spawn glue so we can unit-test every branch
 * without touching the network or the file system.
 *
 * Holder states:
 *   - "self"        → idempotent re-register; reuse the port
 *   - "stale-self"  → dead PID we own; take over with --force
 *   - "foreign"     → live process we don't own; fall back or fail
 *   - "free"        → no holder; bind directly
 */
describe("Story · Dev-Runner probe-to-action planner", () => {
  describe("port is free", () => {
    it("returns use-port when nothing holds the port", () => {
      const probe: DevRunnerProbeResult = { holder: "free", port: 3000 };
      const decision = planDevRunnerAction(probe);
      expect(decision.action).toBe("use-port");
      expect(decision.port).toBe(3000);
      // Message is printed via the survival banner, not stderr — the
      // happy path needs no warning.
      expect(decision.message).toMatch(/binding 3000/i);
    });
  });

  describe("port held by us (idempotent restart)", () => {
    it("returns use-port and notes the self-takeover for portless reuse", () => {
      const probe: DevRunnerProbeResult = { holder: "self", port: 3000 };
      const decision = planDevRunnerAction(probe);
      expect(decision.action).toBe("use-port");
      expect(decision.port).toBe(3000);
      expect(decision.message).toMatch(/self/i);
    });
  });

  describe("port held by stale us (kill -9 leftover)", () => {
    it("returns use-port + takeover hint when our previous PID is dead", () => {
      const probe: DevRunnerProbeResult = { holder: "stale-self", port: 3000 };
      const decision = planDevRunnerAction(probe);
      expect(decision.action).toBe("use-port");
      expect(decision.port).toBe(3000);
      // Non-silent: the user must see we evicted the stale entry.
      expect(decision.message).toMatch(/stale|takeover/i);
    });
  });

  describe("port held by a foreign process", () => {
    it("returns use-fallback when a fallback port is offered", () => {
      const probe: DevRunnerProbeResult = {
        holder: "foreign",
        port: 3000,
        chosenFallbackPort: 3010,
      };
      const decision = planDevRunnerAction(probe);
      expect(decision.action).toBe("use-fallback");
      expect(decision.port).toBe(3010);
      // Mention BOTH ports so the user knows what changed.
      expect(decision.message).toContain("3000");
      expect(decision.message).toContain("3010");
    });

    it("returns fail-fast when no fallback port is available", () => {
      // The runner reaches this branch when find-free-port exhausts its
      // window or when PORT was set explicitly (no fallback allowed).
      const probe: DevRunnerProbeResult = { holder: "foreign", port: 3000 };
      const decision = planDevRunnerAction(probe);
      expect(decision.action).toBe("fail-fast");
      // Three escape hatches must be in the message — the friction
      // author specifically asked for "non-silent exit on port collision".
      expect(decision.message).toMatch(/lsof -i :3000/);
      expect(decision.message).toMatch(/PORT=/);
      expect(decision.message).toMatch(/DISABLE_PORTLESS=1/);
    });
  });
});

/**
 * Structural assertions: the runner script wires the survival banner
 * + the pre-flight probe + the uncaughtException trap. These guard
 * the friction-specific contract — a future refactor that drops the
 * banner emit or the probe call would silently regress the fix.
 */
describe("Story · Dev-Runner script wiring", () => {
  it("imports the survival-banner formatter from the dev module", () => {
    expect(DEV_SCRIPT).toMatch(/formatDevSurvivalBanner/);
  });

  it("imports the port-collision message formatter", () => {
    expect(DEV_SCRIPT).toMatch(/formatPortCollisionMessage/);
  });

  it("imports findFreePort + isPortFree for pre-flight probing", () => {
    expect(DEV_SCRIPT).toMatch(/findFreePort/);
    expect(DEV_SCRIPT).toMatch(/isPortFree/);
  });

  it("registers an uncaughtException handler so runner crashes are non-silent", () => {
    expect(DEV_SCRIPT).toMatch(/process\.on\(['"]uncaughtException['"]/);
  });

  it("registers an unhandledRejection handler so promise crashes are non-silent", () => {
    expect(DEV_SCRIPT).toMatch(/process\.on\(['"]unhandledRejection['"]/);
  });

  it("logs a child-exit hint when the API child dies with a non-zero code", () => {
    // The hint must mention EADDRINUSE so the most common cause
    // (port-collision) is the first thing the user sees.
    expect(DEV_SCRIPT).toMatch(/EADDRINUSE/);
  });
});
