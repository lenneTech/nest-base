/**
 * portless integration.
 *
 * Pure functions used by `scripts/dev.ts` to decide whether to boot
 * portless, build its argv, and pick a port for the no-portless
 * fallback. Side-effecting binary lookup + process spawning live in
 * the script — these helpers stay pure so tests can exercise them
 * without touching the filesystem or env.
 *
 * portless 0.11+ replaced its YAML-config model with a per-process CLI:
 * `portless run --name <name> -- <cmd>` wraps a dev command and routes
 * `https://<name>.localhost` to it. The proxy daemon must be running
 * (start once with `portless proxy start`) and the root CA installed
 * (one-time `portless trust`).
 */

export interface ShouldUsePortlessInput {
  /** Absolute path to the portless binary, or `undefined` if not on PATH. */
  portlessPath: string | undefined;
  /** Explicit override (`DISABLE_PORTLESS=1`) — wins over `portlessPath`. */
  disable?: boolean;
}

export function shouldUsePortless(input: ShouldUsePortlessInput): boolean {
  if (input.disable) return false;
  return input.portlessPath !== undefined && input.portlessPath !== "";
}

export interface ResolveDevPortInput {
  env: { PORT?: string };
  portlessAvailable: boolean;
}

const PORTLESS_DEFAULT_PORT = 3000;

/**
 * Resolve the port for the dev server.
 *
 * - explicit `PORT` env-var → use it
 * - portless available     → bind the conventional 3000 (portless will
 *                            override via `PORT=<picked>` when running
 *                            `portless run`, but the planner default is
 *                            preserved for tooling that asks)
 * - portless missing       → bind 0 (dynamic) so multiple checkouts coexist
 */
export function resolveDevPort(input: ResolveDevPortInput): number {
  const raw = input.env.PORT;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`PORT must be an integer (received: ${raw})`);
    }
    return n;
  }
  return input.portlessAvailable ? PORTLESS_DEFAULT_PORT : 0;
}

export interface BuildPortlessRunCommandInput {
  /** Comes from package.json["name"] — the bottom segment of the URL. */
  projectName: string;
  /** Optional service prefix, e.g. `api` → `api.<projectName>.localhost`. */
  app?: string;
  /** The dev command to wrap, e.g. `['bun', '--watch', 'src/main.ts']`. */
  target: string[];
  /**
   * Add `--force` to the portless run argv. The dev runner sets this
   * after `decideRegistrationAction` returns "take-over" — i.e. the
   * existing PID in routes.json is dead and the registration is
   * orphaned. portless then evicts the stale entry and registers us.
   */
  force?: boolean;
}

/**
 * Builds the argv for `portless run`. Returns the args *after* the
 * binary path so the caller can spawn `[portlessPath, ...args]`.
 *
 * Format: `run --name <fullName> [--force] -- <target...>`.
 * `<fullName>` is `<app>.<projectName>` when `app` is given, otherwise
 * just `<projectName>`. Worktree branch prefixes are added by portless
 * itself if the repo is on a non-default branch.
 */
export function buildPortlessRunCommand(input: BuildPortlessRunCommandInput): string[] {
  if (!input.projectName) {
    throw new Error("buildPortlessRunCommand: projectName must not be empty");
  }
  if (input.target.length === 0) {
    throw new Error("buildPortlessRunCommand: target must not be empty");
  }
  const fullName = input.app ? `${input.app}.${input.projectName}` : input.projectName;
  const flags: string[] = [];
  if (input.force) flags.push("--force");
  return ["run", "--name", fullName, ...flags, "--", ...input.target];
}

/**
 * Decide what to do with an existing entry in portless's
 * `~/.portless/routes.json`. The runner reads the file and calls this
 * planner before invoking `portless run`; the decision determines
 * whether to add `--force` to the argv.
 *
 * Why we need this at all: when a previous `bun --watch` is killed
 * unexpectedly (SIGKILL, OOM, terminal closed), its registration in
 * the routes file outlives the process. portless DOES detect this
 * — its `addRoute()` check uses `process.kill(pid, 0)` and skips the
 * conflict if the holder is dead. But:
 *   1. Some PIDs get re-used by unrelated processes — portless then
 *      raises `RouteConflictError` even though the holder is gone.
 *   2. Some shells reap the process but leave the registration
 *      because portless never got SIGTERM'd (e.g. `kill -9`).
 *
 * The planner gives the dev runner a defence-in-depth pass: read the
 * routes file directly, decide based on `process.kill(pid, 0)`, and
 * add `--force` only when truly safe (existing PID is dead AND not
 * the current process).
 */
export type RegistrationDecision = "no-existing" | "take-over" | "block-with-error";

export interface DecideRegistrationActionInput {
  /** PID stored in `~/.portless/routes.json` for the target hostname. */
  existingPid: number | undefined;
  /** Our own PID (used to short-circuit "self-conflict" → idempotent re-register). */
  currentPid: number;
  /** Result of `process.kill(existingPid, 0)` — true when alive, false when ESRCH. */
  isAlive: boolean;
}

export function decideRegistrationAction(
  input: DecideRegistrationActionInput,
): RegistrationDecision {
  // No record (or sentinel pid 0): nothing to take over, register fresh.
  if (input.existingPid === undefined) return "no-existing";
  if (input.existingPid === 0) return "no-existing";

  // Self-conflict: portless's own self-PID branch already filters this
  // out, but if it ever didn't, taking over with --force would SIGTERM
  // ourselves. Treat as "no conflict, just (re-)register".
  if (input.existingPid === input.currentPid) return "no-existing";

  // Different PID + alive → genuine conflict (another `bun run dev` in
  // a sibling shell). Surface portless's normal error.
  if (input.isAlive) return "block-with-error";

  // Different PID + dead → stale entry from a hard-killed predecessor.
  // Take over silently.
  return "take-over";
}

/**
 * TCP-pings 127.0.0.1:443 with a short timeout. Returns true when the
 * portless proxy daemon is listening, false otherwise. Used by `dev.ts`
 * to decide whether the banner can claim "portless is active" — without
 * the daemon up, the route 404s and the URL is misleading.
 */
export async function isPortlessProxyRunning(timeoutMs: number = 300): Promise<boolean> {
  const { connect } = await import("node:net");
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: 443, timeout: timeoutMs });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
    socket.on("timeout", () => finish(false));
  });
}
