import { spawn } from "node:child_process";
import { connect } from "node:net";

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
    ((databaseUrl: string) => waitForPostgresTcp(databaseUrl, DEFAULT_WAIT_MS));

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

function parseDatabaseUrlForProbe(url: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(url);
    const port = parsed.port ? Number(parsed.port) : 5432;
    if (!Number.isFinite(port)) return null;
    return { host: parsed.hostname, port };
  } catch {
    return null;
  }
}

async function waitForPostgresTcp(databaseUrl: string, timeoutMs: number): Promise<boolean> {
  const target = parseDatabaseUrlForProbe(databaseUrl);
  if (!target) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await probeTcpOnce(target.host, target.port);
    if (ok) return true;
    await sleep(DEFAULT_PROBE_INTERVAL_MS);
  }
  return false;
}

function spawnCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
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

function probeTcpOnce(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 800 });
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
