import { describe, expect, it } from "vitest";

import {
  decideRegistrationAction,
  type RegistrationDecision,
} from "../../src/core/dev/portless.js";

/**
 * Story · Stale portless registration takeover.
 *
 * When a previous `bun --watch` is killed unexpectedly (SIGKILL, OOM,
 * Ctrl-Z + closed terminal), its registration in `~/.portless/routes.json`
 * outlives the process. The next `bun run dev` then bails with
 *   `"api.<workspace>.localhost" is already registered by a running
 *    process (PID <stale>). Use --force to override.`
 * even though the holding process is gone.
 *
 * The pure decision is encoded in `decideRegistrationAction`:
 *
 * | existing record? | PID alive? | same as current? | decision           |
 * | ---------------- | ---------- | ---------------- | ------------------ |
 * | absent           | -          | -                | "no-existing"      |
 * | present          | dead       | -                | "take-over"        |
 * | present          | alive      | yes              | "no-existing" *    |
 * | present          | alive      | no               | "block-with-error" |
 *
 * (*) when the existing record points to the current process, there is
 * nothing to take over. The runner re-registers idempotently. This is
 * NOT auto-take-over — that would mask a logic bug if portless ever
 * decided to allow same-PID self-conflicts.
 */
describe("Story · decideRegistrationAction()", () => {
  it("returns 'no-existing' when the routes registry has no entry for the hostname", () => {
    const decision: RegistrationDecision = decideRegistrationAction({
      existingPid: undefined,
      currentPid: 12345,
      isAlive: false,
    });
    expect(decision).toBe("no-existing");
  });

  it("returns 'take-over' when the existing PID is dead", () => {
    expect(
      decideRegistrationAction({
        existingPid: 99999,
        currentPid: 12345,
        isAlive: false,
      }),
    ).toBe("take-over");
  });

  it("returns 'block-with-error' when the existing PID is a different live process", () => {
    expect(
      decideRegistrationAction({
        existingPid: 99999,
        currentPid: 12345,
        isAlive: true,
      }),
    ).toBe("block-with-error");
  });

  it("returns 'no-existing' when the existing record IS the current process (idempotent re-register, NOT auto-take-over)", () => {
    // Critical: if existingPid === currentPid we MUST NOT pass --force
    // — that would tell portless to SIGTERM ourselves. Treat the case
    // as "no conflict, just (re-)register".
    expect(
      decideRegistrationAction({
        existingPid: 12345,
        currentPid: 12345,
        isAlive: true,
      }),
    ).toBe("no-existing");
  });

  it("treats existingPid 0 (unknown) as no existing record", () => {
    // portless permits a `pid: 0` placeholder for "registered but no
    // owner". There is nothing to take over from a placeholder; just
    // register normally.
    expect(
      decideRegistrationAction({
        existingPid: 0,
        currentPid: 12345,
        isAlive: false,
      }),
    ).toBe("no-existing");
  });
});
