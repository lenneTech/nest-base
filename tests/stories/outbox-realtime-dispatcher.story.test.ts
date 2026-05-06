import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type RealtimeBroadcastTarget,
  RealtimeOutboxDispatcher,
} from "../../src/core/realtime/outbox-realtime.dispatcher.js";
import type { OutboxEntry } from "../../src/core/outbox/outbox.js";

/**
 * Story · Realtime OutboxDispatcher (CF.RT.04 — Finding 9).
 *
 * Iter-39 introduced the `outbox-realtime.bridge.ts` planner; iter-92
 * wraps it in an `OutboxDispatcher` provider so realtime broadcasts
 * actually fan out from the per-second outbox tick. The dispatcher
 * is registered on `OUTBOX_DISPATCHERS` so `OutboxWorkerLifecycle`
 * iterates it alongside webhook + search dispatchers.
 *
 * Routing matrix (per the planner):
 *   - kind ≠ "realtime.broadcast" → no-op (other dispatcher's
 *     responsibility)
 *   - scope: tenant   → broadcast to `tenant:<tenantId>` room
 *   - scope: user     → broadcast to `user:<userId>` room
 *   - scope: global   → broadcastGlobal (server.emit)
 */
describe("Story · RealtimeOutboxDispatcher", () => {
  function makeEntry(payload: unknown, type = "realtime.broadcast"): OutboxEntry {
    return {
      id: `entry-${Math.random().toString(36).slice(2, 10)}`,
      seq: 1,
      tenantId: "t-1",
      type,
      payload,
      occurredAt: new Date(),
      processedAt: null,
    };
  }

  function fakeGateway(): {
    targets: RealtimeBroadcastTarget[];
    broadcast: (room: string, event: string, payload: unknown) => void;
    broadcastGlobal: (event: string, payload: unknown) => void;
  } {
    const targets: RealtimeBroadcastTarget[] = [];
    return {
      targets,
      broadcast(room, event, payload) {
        targets.push({ kind: "room", room, event, payload });
      },
      broadcastGlobal(event, payload) {
        targets.push({ kind: "global", event, payload });
      },
    };
  }

  describe("name + interface", () => {
    it("exposes a stable dispatcher name", () => {
      const gateway = fakeGateway();
      const dispatcher = new RealtimeOutboxDispatcher(gateway);
      expect(dispatcher.name).toBe("realtime-outbox");
    });
  });

  describe("dispatch routing", () => {
    it("routes a tenant-scoped broadcast to `tenant:<id>` via gateway.broadcast", async () => {
      const gateway = fakeGateway();
      const dispatcher = new RealtimeOutboxDispatcher(gateway);
      await dispatcher.dispatch(
        makeEntry({
          channel: "todo.created",
          payload: { id: "t-1" },
          scope: { kind: "tenant", tenantId: "tenant-1" },
        }),
      );
      expect(gateway.targets).toEqual([
        {
          kind: "room",
          room: "tenant:tenant-1",
          event: "todo.created",
          payload: { id: "t-1" },
        },
      ]);
    });

    it("routes a user-scoped broadcast to `user:<id>`", async () => {
      const gateway = fakeGateway();
      const dispatcher = new RealtimeOutboxDispatcher(gateway);
      await dispatcher.dispatch(
        makeEntry({
          channel: "notification.delivered",
          payload: { count: 1 },
          scope: { kind: "user", userId: "user-1" },
        }),
      );
      expect(gateway.targets).toEqual([
        {
          kind: "room",
          room: "user:user-1",
          event: "notification.delivered",
          payload: { count: 1 },
        },
      ]);
    });

    it("routes a global-scoped broadcast via gateway.broadcastGlobal (no room)", async () => {
      const gateway = fakeGateway();
      const dispatcher = new RealtimeOutboxDispatcher(gateway);
      await dispatcher.dispatch(
        makeEntry({
          channel: "system.announcement",
          payload: { message: "Maintenance" },
          scope: { kind: "global" },
        }),
      );
      expect(gateway.targets).toEqual([
        {
          kind: "global",
          event: "system.announcement",
          payload: { message: "Maintenance" },
        },
      ]);
    });

    it("ignores non-realtime entries (other dispatcher's responsibility)", async () => {
      const gateway = fakeGateway();
      const dispatcher = new RealtimeOutboxDispatcher(gateway);
      await dispatcher.dispatch(
        makeEntry({ url: "https://hooks.example.com/in" }, "webhook.delivery"),
      );
      expect(gateway.targets).toHaveLength(0);
    });

    it("does NOT throw when the gateway is null (graceful degradation pre-Socket-server boot)", async () => {
      const dispatcher = new RealtimeOutboxDispatcher(null);
      await expect(
        dispatcher.dispatch(
          makeEntry({
            channel: "todo.created",
            payload: { id: "t-1" },
            scope: { kind: "tenant", tenantId: "tenant-1" },
          }),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("registered with OUTBOX_DISPATCHERS", () => {
    let app: import("@nestjs/common").INestApplication;

    beforeAll(async () => {
      const { bootstrap } = await import("../../src/core/app/bootstrap.js");
      app = await bootstrap({
        listen: false,
        logger: { log() {}, warn() {}, error() {}, debug() {}, verbose() {} },
      });
    });

    afterAll(async () => {
      if (app) await app.close();
    });

    it("OutboxModule's OUTBOX_DISPATCHERS multi-provider includes the realtime dispatcher", async () => {
      const { OUTBOX_DISPATCHERS } = await import("../../src/core/outbox/outbox.module.js");
      const dispatchers = app.get<readonly { name: string }[]>(OUTBOX_DISPATCHERS);
      expect(Array.isArray(dispatchers)).toBe(true);
      const names = dispatchers.map((d) => d.name);
      expect(names).toContain("realtime-outbox");
    });
  });
});
