/**
 * Browser-Auto-Open planner.
 *
 * Pure function that decides — given the current platform, env, and a
 * couple of opt-out flags — whether the bootstrapper should spawn a
 * browser-open command on dev startup, and if so, which command.
 *
 * Runtime behavior:
 *   - dev only (production / test never trigger an open)
 *   - skipped under CI (`CI=true`)
 *   - skipped when `NO_OPEN=1` or `BROWSER=none`
 *   - skipped when stdout is not a TTY (so `bun run dev > log.txt`
 *     doesn't yank the user's focus)
 *
 * The runner in `bootstrap.ts` calls `spawn(...)` with the planner's
 * output and detaches; failures are swallowed so a missing `xdg-open`
 * never crashes the boot.
 */

export type BrowserOpenPlatform = "darwin" | "linux" | "win32" | "other";

export interface BrowserOpenInput {
  /** Target URL. */
  url: string;
  /** Process platform — derives the OS-specific command. */
  platform: BrowserOpenPlatform;
  /** App env. */
  env: "development" | "production" | "test" | "staging";
  /** Whether stdout is a TTY (interactive terminal). */
  isTTY: boolean;
  /** Selected env-vars surface. */
  env_vars?: {
    CI?: string;
    NO_OPEN?: string;
    BROWSER?: string;
  };
}

export type BrowserOpenPlan =
  | { action: "open"; command: string; args: string[] }
  | { action: "skip"; reason: string };

export function planBrowserOpen(input: BrowserOpenInput): BrowserOpenPlan {
  if (input.env !== "development") {
    return { action: "skip", reason: `env is ${input.env}, not development` };
  }
  if (!input.isTTY) {
    return { action: "skip", reason: "stdout is not a TTY" };
  }
  const vars = input.env_vars ?? {};
  if (vars.CI && vars.CI !== "" && vars.CI !== "false" && vars.CI !== "0") {
    return { action: "skip", reason: "CI environment detected" };
  }
  if (vars.NO_OPEN === "1") {
    return { action: "skip", reason: "NO_OPEN=1 set" };
  }
  if (vars.BROWSER === "none") {
    return { action: "skip", reason: "BROWSER=none set" };
  }

  switch (input.platform) {
    case "darwin":
      return { action: "open", command: "open", args: [input.url] };
    case "linux":
      return { action: "open", command: "xdg-open", args: [input.url] };
    case "win32":
      // `start` needs an empty title argument to handle URLs with `&`.
      return { action: "open", command: "cmd", args: ["/c", "start", "", input.url] };
    default:
      return { action: "skip", reason: `unsupported platform: ${input.platform}` };
  }
}
