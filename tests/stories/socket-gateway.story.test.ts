import { describe, expect, it } from "vitest";

import { buildAbility } from "../../src/core/permissions/casl-ability.js";
import {
  HandshakeFailedError,
  PermissionDeniedError,
  SocketGateway,
  type SessionResolver,
  type SocketServer,
  type SocketClient,
} from "../../src/core/realtime/socket-gateway.js";

/**
 * Story · Socket.IO Gateway.
 *
 * Three concerns glued together:
 *   1. Auth-handshake: a connecting socket presents a token; the
 *      session resolver returns {userId, tenantId, ability} or null.
 *   2. Room subscriptions: `subscribe(socket, channel)` runs the
 *      permission check from iteration 48 (`canSubscribeToChannel`)
 *      and joins the socket to the room only if the ability allows.
 *   3. Dispatch: `dispatch(channel, payload)` emits to every joined
 *      socket through the abstract `SocketServer` adapter.
 *
 * The Socket.IO library binding lives in the realtime-module wiring;
 * tests use a stub `SocketServer` so the unit suite stays free of
 * the network layer.
 */

class FakeSocket implements SocketClient {
  rooms = new Set<string>();
  emitted: Array<{ event: string; payload: unknown }> = [];
  constructor(public readonly id: string) {}
  join(room: string): void {
    this.rooms.add(room);
  }
  leave(room: string): void {
    this.rooms.delete(room);
  }
  emit(event: string, payload: unknown): void {
    this.emitted.push({ event, payload });
  }
}

class FakeServer implements SocketServer {
  private readonly sockets: FakeSocket[] = [];
  add(socket: FakeSocket): void {
    this.sockets.push(socket);
  }
  emitTo(room: string, event: string, payload: unknown): void {
    for (const s of this.sockets) {
      if (s.rooms.has(room)) s.emit(event, payload);
    }
  }
}

function makeResolver(
  map: Record<
    string,
    {
      userId: string;
      tenantId: string;
      rules: Array<{ action: string; subject: string; conditions?: Record<string, unknown> }>;
    }
  >,
): SessionResolver {
  return {
    async resolve(token) {
      const session = map[token];
      if (!session) return null;
      return {
        userId: session.userId,
        tenantId: session.tenantId,
        ability: buildAbility(session.rules),
      };
    },
  };
}

describe("Story · Socket Gateway", () => {
  describe("handshake()", () => {
    it("returns the session for a valid token", async () => {
      const gateway = new SocketGateway(
        new FakeServer(),
        makeResolver({
          "tok-1": {
            userId: "u1",
            tenantId: "t1",
            rules: [{ action: "read", subject: "Project" }],
          },
        }),
      );
      const session = await gateway.handshake("tok-1");
      expect(session.userId).toBe("u1");
      expect(session.tenantId).toBe("t1");
    });

    it("throws HandshakeFailedError on an unknown token", async () => {
      const gateway = new SocketGateway(new FakeServer(), makeResolver({}));
      await expect(gateway.handshake("bad")).rejects.toThrow(HandshakeFailedError);
    });

    it("throws HandshakeFailedError on an empty token", async () => {
      const gateway = new SocketGateway(new FakeServer(), makeResolver({}));
      await expect(gateway.handshake("")).rejects.toThrow(HandshakeFailedError);
    });
  });

  describe("subscribe()", () => {
    it("joins the socket to the room when the ability allows", async () => {
      const server = new FakeServer();
      const socket = new FakeSocket("s1");
      server.add(socket);
      const gateway = new SocketGateway(
        server,
        makeResolver({
          "tok-1": {
            userId: "u1",
            tenantId: "t1",
            rules: [{ action: "read", subject: "Project" }],
          },
        }),
      );
      const session = await gateway.handshake("tok-1");
      await gateway.subscribe(socket, session, "Project:item:abc");
      expect(socket.rooms.has("Project:item:abc")).toBe(true);
    });

    it("throws PermissionDeniedError when the ability denies", async () => {
      const server = new FakeServer();
      const socket = new FakeSocket("s1");
      server.add(socket);
      const gateway = new SocketGateway(
        server,
        makeResolver({
          "tok-1": { userId: "u1", tenantId: "t1", rules: [{ action: "read", subject: "User" }] },
        }),
      );
      const session = await gateway.handshake("tok-1");
      await expect(gateway.subscribe(socket, session, "Project:item:abc")).rejects.toThrow(
        PermissionDeniedError,
      );
      expect(socket.rooms.size).toBe(0);
    });

    it("honors tenant-scoped channel conditions", async () => {
      const server = new FakeServer();
      const socket = new FakeSocket("s1");
      server.add(socket);
      const gateway = new SocketGateway(
        server,
        makeResolver({
          "tok-1": {
            userId: "u1",
            tenantId: "t1",
            rules: [{ action: "read", subject: "Project", conditions: { tenantId: "t1" } }],
          },
        }),
      );
      const session = await gateway.handshake("tok-1");
      await gateway.subscribe(socket, session, "Project:tenant:t1");
      await expect(gateway.subscribe(socket, session, "Project:tenant:t2")).rejects.toThrow(
        PermissionDeniedError,
      );
    });
  });

  describe("unsubscribe() / dispatch()", () => {
    it("unsubscribe() removes the socket from the room", async () => {
      const server = new FakeServer();
      const socket = new FakeSocket("s1");
      server.add(socket);
      const gateway = new SocketGateway(
        server,
        makeResolver({
          "tok-1": {
            userId: "u1",
            tenantId: "t1",
            rules: [{ action: "read", subject: "Project" }],
          },
        }),
      );
      const session = await gateway.handshake("tok-1");
      await gateway.subscribe(socket, session, "Project:item:abc");
      gateway.unsubscribe(socket, "Project:item:abc");
      expect(socket.rooms.size).toBe(0);
    });

    it("dispatch() emits to every joined socket", async () => {
      const server = new FakeServer();
      const socket = new FakeSocket("s1");
      server.add(socket);
      const gateway = new SocketGateway(
        server,
        makeResolver({
          "tok-1": {
            userId: "u1",
            tenantId: "t1",
            rules: [{ action: "read", subject: "Project" }],
          },
        }),
      );
      const session = await gateway.handshake("tok-1");
      await gateway.subscribe(socket, session, "Project:item:abc");
      gateway.dispatch("Project:item:abc", "event", { status: "ok" });
      expect(socket.emitted).toEqual([{ event: "event", payload: { status: "ok" } }]);
    });

    it("dispatch() does not emit to sockets that did not join the room", async () => {
      const server = new FakeServer();
      const a = new FakeSocket("a");
      const b = new FakeSocket("b");
      server.add(a);
      server.add(b);
      const gateway = new SocketGateway(
        server,
        makeResolver({
          "tok-1": {
            userId: "u1",
            tenantId: "t1",
            rules: [{ action: "read", subject: "Project" }],
          },
        }),
      );
      const session = await gateway.handshake("tok-1");
      await gateway.subscribe(a, session, "Project:item:abc");
      gateway.dispatch("Project:item:abc", "event", { status: "ok" });
      expect(a.emitted).toHaveLength(1);
      expect(b.emitted).toEqual([]);
    });
  });
});
