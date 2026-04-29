import { describe, expect, it } from "vitest";

import {
  InMemoryRealtimeTransport,
  RealtimeService,
  type RealtimeTransport,
} from "../../src/core/realtime/realtime.service.js";

/**
 * Story · Realtime-Service (PLAN.md §12 + §32 Phase 5).
 *
 * Each server instance listens on a Postgres connection; a NOTIFY
 * payload arrives, the service routes to local subscribers (Socket.IO
 * sockets, server-side handlers, …). Production uses
 * `PostgresRealtimeTransport` (next slice / wiring); the unit suite
 * uses the in-memory transport that mirrors the same surface.
 */
describe("Story · Realtime Service", () => {
  it("publish() delivers to every subscriber registered for the channel", async () => {
    const svc = new RealtimeService(new InMemoryRealtimeTransport());
    await svc.start();
    const seen: string[] = [];
    svc.subscribe("Project:item:abc", (payload) => {
      seen.push(`a:${JSON.stringify(payload)}`);
    });
    svc.subscribe("Project:item:abc", (payload) => {
      seen.push(`b:${JSON.stringify(payload)}`);
    });
    await svc.publish("Project:item:abc", { event: "updated" });
    await svc.flush();
    expect(seen.sort()).toEqual([`a:{"event":"updated"}`, `b:{"event":"updated"}`]);
    await svc.stop();
  });

  it("publish() does not call subscribers of other channels", async () => {
    const svc = new RealtimeService(new InMemoryRealtimeTransport());
    await svc.start();
    let other = 0;
    svc.subscribe("Other:item:xyz", () => {
      other++;
    });
    await svc.publish("Project:item:abc", { event: "updated" });
    await svc.flush();
    expect(other).toBe(0);
    await svc.stop();
  });

  it("subscribe() returns an unsubscribe function", async () => {
    const svc = new RealtimeService(new InMemoryRealtimeTransport());
    await svc.start();
    let count = 0;
    const off = svc.subscribe("c", () => {
      count++;
    });
    await svc.publish("c", {});
    await svc.flush();
    off();
    await svc.publish("c", {});
    await svc.flush();
    expect(count).toBe(1);
    await svc.stop();
  });

  it("an exception thrown by one subscriber does not stop sibling subscribers", async () => {
    const svc = new RealtimeService(new InMemoryRealtimeTransport());
    await svc.start();
    let sibling = 0;
    svc.subscribe("c", () => {
      throw new Error("boom");
    });
    svc.subscribe("c", () => {
      sibling++;
    });
    await svc.publish("c", {});
    await svc.flush();
    expect(sibling).toBe(1);
    await svc.stop();
  });

  it("publish() before start() is rejected with a deterministic error", async () => {
    const svc = new RealtimeService(new InMemoryRealtimeTransport());
    await expect(svc.publish("c", {})).rejects.toThrow(/start/i);
  });

  it("subscribe() before start() still works (subscribers persist across start cycles)", async () => {
    const svc = new RealtimeService(new InMemoryRealtimeTransport());
    let count = 0;
    svc.subscribe("c", () => {
      count++;
    });
    await svc.start();
    await svc.publish("c", {});
    await svc.flush();
    expect(count).toBe(1);
    await svc.stop();
  });

  describe("Transport contract", () => {
    it("start() listens on the transport, stop() closes it", async () => {
      const calls: string[] = [];
      const transport: RealtimeTransport = {
        async start() {
          calls.push("start");
        },
        async stop() {
          calls.push("stop");
        },
        async notify(channel, payload) {
          calls.push(`notify:${channel}:${JSON.stringify(payload)}`);
        },
        onMessage(_handler) {
          // not used in this test
        },
      };
      const svc = new RealtimeService(transport);
      await svc.start();
      await svc.publish("c", { x: 1 });
      await svc.stop();
      expect(calls).toEqual(["start", 'notify:c:{"x":1}', "stop"]);
    });

    it("messages from the transport (cross-instance NOTIFY) reach subscribers", async () => {
      const transport = new InMemoryRealtimeTransport();
      const svc = new RealtimeService(transport);
      await svc.start();
      const seen: unknown[] = [];
      svc.subscribe("c", (payload) => {
        seen.push(payload);
      });

      // Simulate a cross-instance NOTIFY (does not call our `notify`).
      transport.simulateIncoming("c", { fromOtherInstance: true });
      await svc.flush();

      expect(seen).toEqual([{ fromOtherInstance: true }]);
      await svc.stop();
    });
  });
});
