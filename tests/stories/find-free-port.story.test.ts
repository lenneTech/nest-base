import { createServer, type Server } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findFreePort,
  FreePortNotFoundError,
  isPortFree,
} from "../../src/core/setup/find-free-port.js";

/**
 * Story · `findFreePort` must detect collisions with Docker / Compose.
 *
 * Background — friction-log run 2026-05-02-18-44-43:
 *   `bun run setup` wrote `POSTGRES_HOST_PORT=5432` even though another
 *   Docker postgres container was already bound on `0.0.0.0:5432`. Cause:
 *   the previous fix (`deacf3c`) probed only the loopback address
 *   (`127.0.0.1`). Docker's port forwarding binds at the wildcard, so a
 *   loopback probe always sees the port as free even though Compose's
 *   subsequent `5432:5432` binding will collide.
 *
 * Pin the contract: `isPortFree` / `findFreePort` must return false
 * (resp. skip) for any port that another process holds on the *wildcard*
 * binding, because that is what `docker compose up` competes with.
 */
describe("Story · findFreePort detects Docker-style wildcard binds", () => {
  const servers: Server[] = [];

  /**
   * Bind a TCP server on the wildcard (`0.0.0.0`) for the duration of one
   * test and return the chosen port. Mirrors how `docker compose up`
   * holds the host port.
   */
  async function holdPortOnWildcard(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.once("listening", () => {
        const addr = server.address();
        if (typeof addr === "object" && addr) {
          servers.push(server);
          resolve(addr.port);
        } else {
          reject(new Error("no address bound"));
        }
      });
      // 0 = let the kernel pick a free port
      server.listen(0, "0.0.0.0");
    });
  }

  beforeEach(() => {
    servers.length = 0;
  });

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => resolve());
          }),
      ),
    );
    servers.length = 0;
  });

  it("isPortFree returns false when the port is bound on 0.0.0.0 (Docker case)", async () => {
    const occupied = await holdPortOnWildcard();
    // Same port on the wildcard is in use; the helper must report busy
    // even though loopback would still bind successfully (kernel allows
    // 127.0.0.1:<p> alongside 0.0.0.0:<p> on Linux/macOS).
    const free = await isPortFree(occupied);
    expect(free).toBe(false);
  });

  it("findFreePort skips a wildcard-bound port and returns the next free one", async () => {
    const start = await holdPortOnWildcard();
    const chosen = await findFreePort(start);
    expect(chosen).toBeGreaterThan(start);
  });

  it("findFreePort returns the start port when nothing is bound there", async () => {
    // Pick an unlikely-to-collide range above the ephemeral floor.
    // Bind+release to discover a port the kernel currently considers free,
    // then ask the helper for it. (The probe is racy by nature, but a
    // single-digit-millisecond window is enough for this assertion.)
    const probe = createServer();
    const port: number = await new Promise((resolve, reject) => {
      probe.once("listening", () => {
        const addr = probe.address();
        if (typeof addr === "object" && addr) resolve(addr.port);
        else reject(new Error("no address"));
      });
      probe.once("error", reject);
      probe.listen(0, "0.0.0.0");
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const chosen = await findFreePort(port);
    expect(chosen).toBe(port);
  });

  it("FreePortNotFoundError is thrown when the entire scan window is busy", async () => {
    // Hold a contiguous block on the wildcard so every probe fails.
    const start = await holdPortOnWildcard();
    // Hold 4 more directly above start. Some may already be in use,
    // which is fine — those probe attempts will also fail and the scan
    // window will exhaust.
    const window = 5;
    for (let i = 1; i < window; i++) {
      await new Promise<void>((resolve) => {
        const s = createServer();
        s.once("error", () => resolve()); // ignore, already busy is fine
        s.once("listening", () => {
          servers.push(s);
          resolve();
        });
        s.listen(start + i, "0.0.0.0");
      });
    }
    // Scan only the held block; expect failure.
    await expect(findFreePort(start, window)).rejects.toBeInstanceOf(FreePortNotFoundError);
  });
});
