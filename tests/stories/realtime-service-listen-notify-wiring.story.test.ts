import { describe, expect, it } from "vitest";

import {
  REALTIME_SERVICE,
  REALTIME_TRANSPORT,
  RealtimeServiceLifecycle,
} from "../../src/core/realtime/realtime-service.lifecycle.js";
import {
  InMemoryRealtimeTransport,
  RealtimeService,
} from "../../src/core/realtime/realtime.service.js";

/**
 * Story · RealtimeService LISTEN/NOTIFY wiring (CF.RT.* — iter-96
 * review Finding 5).
 *
 * The PRD pins "LISTEN / NOTIFY → Socket.IO gateway" as the
 * cross-instance fan-out transport. `RealtimeService` shipped with a
 * production-grade `start/stop/publish/subscribe` API + an
 * `InMemoryRealtimeTransport` for tests, but `RealtimeModule` did
 * not declare it as a provider — the class was orphan.
 *
 * Iter-102 closes the loop with three artefacts:
 *  1. `REALTIME_SERVICE` and `REALTIME_TRANSPORT` DI tokens.
 *  2. `RealtimeServiceLifecycle` Nest provider — at
 *     `OnModuleInit` calls `service.start()`, subscribes to every
 *     incoming NOTIFY via the cross-channel handler, and fans the
 *     payload into the local `RealtimeGateway.broadcast(...)`. At
 *     `OnModuleDestroy` calls `service.stop()`.
 *  3. RealtimeModule registers both tokens as providers (default:
 *     in-memory transport so test bootstraps don't require a live
 *     Postgres LISTEN connection).
 */
describe("Story · RealtimeServiceLifecycle", () => {
  it("exposes the canonical DI tokens", () => {
    expect(REALTIME_SERVICE.description).toContain("RealtimeService");
    expect(REALTIME_TRANSPORT.description).toContain("RealtimeTransport");
  });

  it("at OnModuleInit: calls service.start() + wires NOTIFY → gateway.broadcast()", async () => {
    const transport = new InMemoryRealtimeTransport();
    const service = new RealtimeService(transport);
    const calls: { channel: string; event: string; payload: unknown }[] = [];
    const gateway = {
      broadcast(channel: string, event: string, payload: unknown): void {
        calls.push({ channel, event, payload });
      },
      broadcastGlobal(): void {
        // Not asserted in this test — covered by iter-92.
      },
    };

    const lifecycle = new RealtimeServiceLifecycle(service, gateway);
    await lifecycle.onModuleInit();

    // Simulate cross-instance NOTIFY: in-memory transport's
    // `notify()` mirrors the loopback semantic.
    await service.publish("user.123", { kind: "ping" });
    await service.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      channel: "user.123",
      payload: { kind: "ping" },
    });

    await lifecycle.onModuleDestroy();
  });

  it("OnModuleDestroy stops the service (no further NOTIFY accepted)", async () => {
    const transport = new InMemoryRealtimeTransport();
    const service = new RealtimeService(transport);
    const gateway = { broadcast(): void {}, broadcastGlobal(): void {} };
    const lifecycle = new RealtimeServiceLifecycle(service, gateway);

    await lifecycle.onModuleInit();
    await lifecycle.onModuleDestroy();

    // After stop, publish() throws because the service is no longer running.
    await expect(service.publish("any", {})).rejects.toThrow(/before start/);
  });

  describe("RealtimeModule registers RealtimeService", () => {
    it("source declares REALTIME_SERVICE + REALTIME_TRANSPORT providers", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const src = readFileSync(
        resolve(process.cwd(), "src/core/realtime/realtime.module.ts"),
        "utf8",
      );
      expect(src).toContain("REALTIME_SERVICE");
      expect(src).toContain("REALTIME_TRANSPORT");
      expect(src).toContain("RealtimeServiceLifecycle");
    });
  });
});
