/**
 * Pure planner: decide what the dev runner should do given the result
 * of probing the target port for an existing holder.
 *
 * Friction 2026-05-03 #14:36 (HIGH) + #14:42 (MEDIUM):
 *   `bun run dev` hangs after route registration when port 3000 is held
 *   by a stale `nuxt dev` from another workspace. The portless takeover
 *   probe `process.kill(pid, 0)` reports the holder alive (it is — just
 *   not ours), so neither the fallback path nor a clear error fires.
 *   The runner just hangs and exits 144.
 *
 * The planner formalises four port-holder states. Pure function — no
 * sockets, no filesystem, no env reads — so all branches are pinned by
 * `tests/stories/dev-runner-banner.story.test.ts`.
 *
 * The runner's responsibility is to (a) gather the probe result via the
 * existing `decideRegistrationAction` + `findFreePort` helpers, (b) call
 * this planner, and (c) act on the returned `{ action, port, message }`:
 *   - "use-port"     → bind the original port; print `message` as info
 *   - "use-fallback" → bind `port` (the fallback); print `message` as warning
 *   - "fail-fast"    → write `message` to stderr and exit 1
 */

export type DevRunnerHolder = "self" | "stale-self" | "foreign" | "free";

export interface DevRunnerProbeResult {
  /**
   * Who currently holds the port:
   *   - "self":       same PID as us (idempotent re-register)
   *   - "stale-self": our previous PID, dead (kill -9 leftover)
   *   - "foreign":    different PID, alive, not ours
   *   - "free":       no holder
   */
  holder: DevRunnerHolder;
  /** The port the runner asked about. */
  port: number;
  /**
   * Optional fallback chosen by `findFreePort` when `holder === "foreign"`.
   * When omitted, foreign holders surface as `fail-fast`.
   */
  chosenFallbackPort?: number;
}

export type DevRunnerAction = "use-port" | "use-fallback" | "fail-fast";

export interface DevRunnerDecision {
  action: DevRunnerAction;
  /** The port the runner should bind. For `fail-fast`, echoes `probe.port`. */
  port: number;
  /**
   * User-facing message. For `use-port` / `use-fallback`, informational.
   * For `fail-fast`, the multi-line collision report (caller writes it
   * to stderr before exiting 1).
   */
  message: string;
}

/**
 * Render the same three escape hatches as `formatPortCollisionMessage`.
 * Inlined here to keep the planner dependency-free; the formatter
 * handles the survival / ready banners.
 */
function renderCollisionMessage(port: number): string {
  return [
    `[dev] port ${port} is already in use by a foreign process`,
    "[dev] try one of:",
    `[dev]   (a) stop the holder: lsof -i :${port} | tail -1`,
    `[dev]   (b) re-run with PORT=<other>`,
    "[dev]   (c) re-run with DISABLE_PORTLESS=1",
  ].join("\n");
}

export function planDevRunnerAction(probe: DevRunnerProbeResult): DevRunnerDecision {
  switch (probe.holder) {
    case "free":
      return {
        action: "use-port",
        port: probe.port,
        message: `[dev] binding ${probe.port}`,
      };
    case "self":
      // Same-PID conflict: portless's idempotent path. Re-register
      // without --force so we don't SIGTERM ourselves.
      return {
        action: "use-port",
        port: probe.port,
        message: `[dev] re-using ${probe.port} (self)`,
      };
    case "stale-self":
      // Different PID + dead == orphaned registration from a hard-killed
      // predecessor. Take over with --force; non-silent so the user
      // notices we evicted the stale entry.
      return {
        action: "use-port",
        port: probe.port,
        message: `[dev] taking over stale registration on ${probe.port}`,
      };
    case "foreign": {
      // Different PID, alive, not ours. The runner's fallback path
      // wins when `findFreePort` produced an alternative; otherwise we
      // fail fast with the three-option recovery hint so the user is
      // never staring at a silent exit 144.
      if (probe.chosenFallbackPort !== undefined) {
        return {
          action: "use-fallback",
          port: probe.chosenFallbackPort,
          message:
            `[dev] port ${probe.port} held by foreign process — falling back to ${probe.chosenFallbackPort}`,
        };
      }
      return {
        action: "fail-fast",
        port: probe.port,
        message: renderCollisionMessage(probe.port),
      };
    }
  }
}
