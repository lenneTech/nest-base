import { spawn } from "node:child_process";

import { Client } from "pg";

import type { SetupBootstrapPlan, SetupBootstrapStep } from "./setup-bootstrap.js";

export interface SetupBootstrapLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface ExecuteSetupBootstrapOptions {
  plan: SetupBootstrapPlan;
  logger: SetupBootstrapLogger;
  /** Override spawn (tests). */
  spawnStep?: (step: SetupBootstrapStep) => Promise<number>;
  /** Override Postgres wait (tests). */
  waitForPostgres?: (databaseUrl: string) => Promise<boolean>;
}

const DEFAULT_WAIT_MS = 60_000;
const DEFAULT_PROBE_INTERVAL_MS = 500;
const DEFAULT_PROBE_TIMEOUT_MS = 3_000;

export interface WaitForPostgresOptions {
  /** Overall budget before giving up. */
  timeoutMs?: number;
  /** Delay between probe attempts. */
  intervalMs?: number;
  /**
   * Single readiness attempt. Resolves `true` only when Postgres can
   * actually serve a query. Injected in tests; defaults to a real
   * connect + `SELECT 1` via `probePostgresReadyOnce`.
   */
  probe?: (databaseUrl: string) => Promise<boolean>;
  /** Clock source (tests). */
  now?: () => number;
  /** Delay primitive (tests). */
  sleep?: (ms: number) => Promise<void>;
}

export async function executeSetupBootstrap(
  options: ExecuteSetupBootstrapOptions,
): Promise<{ ok: boolean; failedStep?: SetupBootstrapStep }> {
  const { plan, logger } = options;
  if (!plan.allowed) {
    logger.warn(plan.refusalReason ?? "bootstrap refused");
    return { ok: false };
  }

  const spawn =
    options.spawnStep ??
    (async (step: SetupBootstrapStep): Promise<number> => {
      if (step.command === "internal") {
        return 0;
      }
      return spawnCommand(step.command, step.args, { ...process.env, ...step.env });
    });

  const waitForPostgres =
    options.waitForPostgres ??
    ((databaseUrl: string) => waitForPostgresReady(databaseUrl, { timeoutMs: DEFAULT_WAIT_MS }));

  for (const step of plan.steps) {
    logger.info(`${step.verb}: ${step.description}`);
    if (step.verb === "wait-postgres") {
      const url = step.env.DATABASE_URL;
      if (!url) {
        logger.warn("wait-postgres: DATABASE_URL missing");
        return { ok: false, failedStep: step };
      }
      const ready = await waitForPostgres(url);
      if (!ready) {
        logger.warn("Postgres did not become reachable in time");
        return { ok: false, failedStep: step };
      }
      continue;
    }

    const exitCode = await spawn(step);
    if (exitCode !== 0) {
      logger.warn(`step "${step.verb}" failed with exit code ${exitCode}`);
      return { ok: false, failedStep: step };
    }
  }

  return { ok: true };
}

/**
 * Poll until Postgres can serve a query or the deadline passes.
 *
 * A bare TCP `connect()` is NOT enough: under docker-compose the port
 * proxy accepts the TCP handshake the moment the container starts, long
 * before PostgreSQL has finished initialising — so a TCP probe reports
 * "ready" almost instantly and the next `migrate` step then fails with
 * `P1001`. This probes at the query level instead, so "ready" means the
 * server actually answered a `SELECT 1`.
 */
export async function waitForPostgresReady(
  databaseUrl: string,
  options: WaitForPostgresOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
  const probe = options.probe ?? ((url: string) => probePostgresReadyOnce(url));
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? sleep;

  const deadline = now() + timeoutMs;
  // Always try at least once; then keep polling until the deadline.
  for (;;) {
    if (await probe(databaseUrl)) return true;
    if (now() >= deadline) return false;
    await wait(intervalMs);
  }
}

/**
 * One readiness attempt: open a real Postgres connection and run
 * `SELECT 1`. Resolves `true` only if that round-trip succeeds; any
 * failure (connection refused, socket accepted by a non-Postgres
 * listener, server still starting up, auth/timeout) resolves `false`.
 *
 * Teardown is forced, not graceful: the exact case this probe defends
 * against — a socket accepted by docker's port proxy while Postgres is
 * still booting — leaves `pg`'s own timers and `end()` handshake with no
 * responsive peer, so they can hang and leak the socket handle. A hard
 * timeout bounds the attempt and the underlying stream is destroyed
 * outright so a failed probe never keeps the loop (or the process) alive.
 */
export async function probePostgresReadyOnce(
  databaseUrl: string,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  let client: Client | undefined;
  try {
    client = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
    });
    const activeClient = client;
    const attempt = (async () => {
      await activeClient.connect();
      await activeClient.query("SELECT 1");
    })();
    // Avoid an unhandled rejection if the hard timeout wins the race.
    attempt.catch(() => {});
    await Promise.race([
      attempt,
      sleep(timeoutMs).then(() => {
        throw new Error("postgres-readiness-probe-timeout");
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    forceCloseClient(client);
  }
}

/**
 * Tear a probe client down without waiting on a graceful `end()`
 * handshake (which needs a cooperative peer). Destroy the raw socket
 * first, then fire `end()` and forget it.
 */
function forceCloseClient(client: Client | undefined): void {
  if (!client) return;
  const stream = (client as unknown as { connection?: { stream?: { destroy?: () => void } } })
    .connection?.stream;
  try {
    stream?.destroy?.();
  } catch {
    /* already gone */
  }
  void client.end().catch(() => {});
}

function spawnCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
