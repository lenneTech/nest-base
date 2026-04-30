import { createServer } from "node:net";

/**
 * `findFreePort(start, [maxScan])` — returns the first TCP port at or
 * after `start` that the host can bind on the loopback. Used by the
 * setup wizard to pick a per-workspace Postgres host-port so two
 * `--next` workspaces don't collide on `5432:5432`.
 *
 * - Probes synchronously by attempting `createServer().listen(port,
 *   '127.0.0.1')` and tearing it down immediately.
 * - Returns `start` itself if free; otherwise scans `start+1`,
 *   `start+2`, … up to `start + maxScan` (default 100).
 * - Throws `FreePortNotFoundError` if the entire window is busy.
 *
 * Pure async function with no global side-effects beyond brief
 * loopback bind attempts.
 */

export class FreePortNotFoundError extends Error {
  constructor(start: number, scanned: number) {
    super(`no free port found in range ${start}..${start + scanned - 1}`);
    this.name = "FreePortNotFoundError";
  }
}

export async function isPortFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function findFreePort(start: number, maxScan = 100): Promise<number> {
  for (let i = 0; i < maxScan; i++) {
    const port = start + i;
    if (await isPortFree(port)) return port;
  }
  throw new FreePortNotFoundError(start, maxScan);
}
