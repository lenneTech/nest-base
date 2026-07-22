import { createServer, type Socket } from "node:net";

import { describe, expect, it } from "vitest";

import {
  probePostgresReadyOnce,
  waitForPostgresReady,
} from "../../src/core/setup/setup-bootstrap-runner.js";

/**
 * Story · setup wait-postgres readiness
 *
 * Regression guard for the smoke-pipeline flake: the old `wait-postgres`
 * step probed with a bare TCP `connect()`. Under docker-compose the port
 * proxy accepts the TCP handshake the instant the container starts —
 * long before PostgreSQL inside the postgis image has finished
 * initialising — so the probe reported "ready" after ~11 ms and the
 * next `migrate` step hit `P1001: Can't reach database server`.
 *
 * The contract these tests pin: readiness means "Postgres can serve a
 * query", not "some process accepted a TCP connection".
 */

/**
 * Run `fn` against a TCP listener that accepts connections and then goes
 * silent — exactly like docker's port proxy before Postgres is up. Server
 * sockets are tracked and destroyed on teardown so `close()` can't block
 * on the still-open probe connection.
 */
async function withSilentTcpListener<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  try {
    return await fn(port);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("Story · setup wait-postgres readiness", () => {
  it("does NOT report ready for a raw TCP listener that never speaks Postgres", async () => {
    // Mirrors the docker-compose port proxy: accepts the TCP connection
    // and holds it open, but is not a Postgres server. A TCP-accept probe
    // would (wrongly) call this ready; the query-level probe must not.
    const ready = await withSilentTcpListener((port) =>
      probePostgresReadyOnce(`postgresql://probe:probe@127.0.0.1:${port}/probe`, 800),
    );
    expect(ready).toBe(false);
  }, 10_000);

  it("reports not-ready for a refused connection (nothing listening)", async () => {
    // Port 1 on loopback: connection refused — the early-boot case before
    // the container's port is even mapped.
    const ready = await probePostgresReadyOnce("postgresql://u:p@127.0.0.1:1/db", 800);
    expect(ready).toBe(false);
  }, 10_000);

  it("reports ready against a live Postgres that answers SELECT 1", async () => {
    // global-setup boots a Postgres testcontainer and exposes its URL —
    // the success path: a real query round-trip resolves `true`.
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("expected global-setup to provide DATABASE_URL");
    const ready = await probePostgresReadyOnce(url, 5_000);
    expect(ready).toBe(true);
  }, 15_000);

  it("keeps retrying until the probe reports ready, not on the first not-ready", async () => {
    let calls = 0;
    const probe = async (): Promise<boolean> => {
      calls += 1;
      return calls >= 3; // not ready twice, then ready
    };
    let clock = 0;
    const ready = await waitForPostgresReady("postgresql://u:p@127.0.0.1:5432/db", {
      timeoutMs: 10_000,
      intervalMs: 100,
      probe,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(ready).toBe(true);
    expect(calls).toBe(3);
  });

  it("gives up and returns false once the deadline passes with no ready probe", async () => {
    let calls = 0;
    const probe = async (): Promise<boolean> => {
      calls += 1;
      return false; // never ready
    };
    let clock = 0;
    const ready = await waitForPostgresReady("postgresql://u:p@127.0.0.1:5432/db", {
      timeoutMs: 1_000,
      intervalMs: 250,
      probe,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(ready).toBe(false);
    // At least one attempt, and it stopped at the deadline (not an
    // infinite loop): 1000ms / 250ms interval → ~5 attempts.
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(calls).toBeLessThanOrEqual(6);
  });
});
