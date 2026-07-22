import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

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
describe("Story · setup wait-postgres readiness", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it("does NOT report ready for a raw TCP listener that never speaks Postgres", async () => {
    // Mirrors the docker-compose port proxy: accepts the TCP connection
    // and holds it open, but is not a Postgres server. A TCP-accept probe
    // would (wrongly) call this ready; the query-level probe must not.
    server = createServer((socket) => {
      // Hold the socket open, send nothing — exactly the failure mode.
      socket.on("error", () => {});
    });
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        const address = server!.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });

    const url = `postgresql://probe:probe@127.0.0.1:${port}/probe`;
    const ready = await probePostgresReadyOnce(url, 800);
    expect(ready).toBe(false);
  }, 5000);

  it("reports not-ready for a refused connection (nothing listening)", async () => {
    // Port 1 on loopback: connection refused — the early-boot case before
    // the container's port is even mapped.
    const ready = await probePostgresReadyOnce("postgresql://u:p@127.0.0.1:1/db", 800);
    expect(ready).toBe(false);
  }, 5000);

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
