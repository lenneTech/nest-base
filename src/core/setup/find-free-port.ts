import { createServer } from "node:net";

/**
 * `findFreePort(start, [maxScan])` — returns the first TCP port at or
 * after `start` that the host can bind on the wildcard address. Used by
 * the setup wizard to pick a per-workspace Postgres host-port so two
 * `--next` workspaces don't collide on `5432:5432`.
 *
 * - Probes by binding `createServer().listen(port, '0.0.0.0')` and
 *   tearing it down immediately. The wildcard probe matters: Docker /
 *   Compose forwards `<host>:<container>` on the wildcard address, so a
 *   loopback-only probe (`127.0.0.1`) reports the port as free even
 *   when `docker compose up` will later fail with `EADDRINUSE` (kernels
 *   on Linux/macOS allow `127.0.0.1:p` to coexist with `0.0.0.0:p`).
 *   Friction-log run `2026-05-02-18-44-43` hit exactly this regression:
 *   another container was bound on `*:5432`, the loopback probe found
 *   it free, the wizard wrote `POSTGRES_HOST_PORT=5432`, and the
 *   subsequent Compose up failed.
 * - Returns `start` itself if free; otherwise scans `start+1`,
 *   `start+2`, … up to `start + maxScan` (default 100).
 * - Throws `FreePortNotFoundError` if the entire window is busy.
 *
 * Pure async function with no global side-effects beyond brief
 * wildcard bind attempts.
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
    // Wildcard bind matches what `docker compose up -d` does with
    // `${POSTGRES_HOST_PORT}:5432` — required to detect collisions
    // against another Docker container holding `*:<port>` (see header).
    server.listen(port, "0.0.0.0");
  });
}

export async function findFreePort(start: number, maxScan = 100): Promise<number> {
  for (let i = 0; i < maxScan; i++) {
    const port = start + i;
    if (await isPortFree(port)) return port;
  }
  throw new FreePortNotFoundError(start, maxScan);
}
