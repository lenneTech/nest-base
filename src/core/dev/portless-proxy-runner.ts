/**
 * I/O helpers for the portless HTTPS proxy daemon (`portless proxy start`).
 *
 * Pure URL/port planning lives in `portless.ts`. This module reads
 * `~/.portless/proxy.{port,pid,tls}` and probes TCP listeners.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

import { isPidAlive } from "./portless-routes-runner.js";

const DEFAULT_HTTPS_PORT = 443;
const FALLBACK_HTTPS_PORT = 1355;

export interface PortlessProxyState {
  port: number;
  pid?: number;
  tls: boolean;
}

export function resolvePortlessStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PORTLESS_STATE_DIR;
  return explicit && explicit.length > 0 ? explicit : join(homedir(), ".portless");
}

function readPositiveIntFile(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, "utf8").trim();
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 65_535) return undefined;
    return n;
  } catch {
    return undefined;
  }
}

/** Reads portless's proxy state files when the daemon is (or was) running. */
export function readPortlessProxyState(
  stateDir: string = resolvePortlessStateDir(),
): PortlessProxyState | undefined {
  const port = readPositiveIntFile(join(stateDir, "proxy.port"));
  if (port === undefined) return undefined;
  const pid = readPositiveIntFile(join(stateDir, "proxy.pid"));
  const tlsRaw = existsSync(join(stateDir, "proxy.tls"))
    ? readFileSync(join(stateDir, "proxy.tls"), "utf8").trim()
    : "1";
  const tls = tlsRaw !== "0";
  return { port, ...(pid !== undefined ? { pid } : {}), tls };
}

export async function isTcpPortOpen(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: timeoutMs });
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

/**
 * True when the portless proxy daemon is listening. Uses `proxy.port`
 * from user state when present; otherwise probes the conventional :443.
 */
export async function isPortlessProxyListening(
  stateDir: string = resolvePortlessStateDir(),
): Promise<boolean> {
  const state = readPortlessProxyState(stateDir);
  if (state?.pid !== undefined && !isPidAlive(state.pid)) {
    return false;
  }
  const port = state?.port ?? DEFAULT_HTTPS_PORT;
  return isTcpPortOpen("127.0.0.1", port);
}

export interface BuildPortlessProxyStartArgsInput {
  /** Unprivileged fallback when :443 needs sudo and the TTY is unavailable. */
  fallbackPort?: number;
  preferFallback?: boolean;
}

/** argv after the `portless` binary for `proxy start`. */
export function buildPortlessProxyStartArgs(
  input: BuildPortlessProxyStartArgsInput = {},
): string[] {
  if (input.preferFallback) {
    const port = input.fallbackPort ?? FALLBACK_HTTPS_PORT;
    return ["proxy", "start", "-p", String(port), "--https"];
  }
  return ["proxy", "start"];
}

export interface EnsurePortlessProxyInput {
  portlessPath: string;
  stateDir?: string;
  spawnSync?: (
    command: string,
    args: string[],
  ) => { exitCode: number | null; stdout: string; stderr: string };
  sleepMs?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
}

export interface EnsurePortlessProxyResult {
  running: boolean;
  port: number;
  https: boolean;
  started: boolean;
}

async function waitForProxy(
  stateDir: string,
  sleepMs: (ms: number) => Promise<void>,
  maxWaitMs: number,
): Promise<PortlessProxyState | undefined> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await isPortlessProxyListening(stateDir)) {
      return readPortlessProxyState(stateDir);
    }
    await sleepMs(200);
  }
  return undefined;
}

/**
 * Starts the portless proxy when it is not already listening. Tries the
 * default :443 first (may prompt for sudo); falls back to an unprivileged
 * HTTPS port when the first attempt does not bring the listener up.
 */
export async function ensurePortlessProxyRunning(
  input: EnsurePortlessProxyInput,
): Promise<EnsurePortlessProxyResult> {
  const stateDir = input.stateDir ?? resolvePortlessStateDir();
  const sleepMs = input.sleepMs ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxWaitMs = input.maxWaitMs ?? 15_000;
  const spawn =
    input.spawnSync ??
    ((command, args) => {
      const result = spawnSync(command, args, { encoding: "utf8" });
      return {
        exitCode: result.status,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    });

  if (await isPortlessProxyListening(stateDir)) {
    const state = readPortlessProxyState(stateDir);
    return {
      running: true,
      port: state?.port ?? DEFAULT_HTTPS_PORT,
      https: state?.tls ?? true,
      started: false,
    };
  }

  const attempts: boolean[] = [false, true];
  for (const preferFallback of attempts) {
    const args = buildPortlessProxyStartArgs({ preferFallback });
    spawn(input.portlessPath, args);
    const state = await waitForProxy(stateDir, sleepMs, maxWaitMs);
    if (state) {
      return {
        running: true,
        port: state.port,
        https: state.tls,
        started: true,
      };
    }
  }

  return {
    running: false,
    port: DEFAULT_HTTPS_PORT,
    https: true,
    started: false,
  };
}
