import { describe, expect, it } from "vitest";

import { buildAbility } from "../../src/core/permissions/casl-ability.js";
import { ChannelFilter, type ChannelSubscriber } from "../../src/core/realtime/channel-filter.js";

/**
 * Story · Permission-Aware Channel-Filter (PLAN.md §12 + §32 Phase 5).
 *
 * After SocketGateway gates *subscription* to a channel, this filter
 * gates *delivery* of each broadcast event so a subscriber only sees
 * the records their Ability allows. Two layers, one CASL evaluation:
 *
 *   subscribe-time:  ability.can('read', subjectType-as-string)
 *   broadcast-time:  ability.can('read', { __caslSubjectType__, ...record })
 *
 * Conditions like `{ tenantId: $CURRENT_USER.tenantId }` (already
 * substituted by the resolver) are honoured per record on every emit.
 */
describe("Story · Permission-Aware Channel-Filter", () => {
  function fakeSocket(id: string): {
    id: string;
    received: Array<{ event: string; payload: unknown }>;
    join(): void;
    leave(): void;
    emit(event: string, payload: unknown): void;
  } {
    const received: Array<{ event: string; payload: unknown }> = [];
    return {
      id,
      received,
      join: () => {},
      leave: () => {},
      emit(event, payload) {
        received.push({ event, payload });
      },
    };
  }

  function subscriber(
    id: string,
    rules: Parameters<typeof buildAbility>[0],
    overrides: { tenantId?: string; userId?: string } = {},
  ): ChannelSubscriber & { socket: ReturnType<typeof fakeSocket> } {
    const socket = fakeSocket(id);
    return {
      socket,
      session: {
        userId: overrides.userId ?? `u-${id}`,
        tenantId: overrides.tenantId ?? "t1",
        ability: buildAbility(rules),
      },
    };
  }

  describe("register / unregister", () => {
    it("register() tracks a subscriber for a channel", () => {
      const filter = new ChannelFilter();
      const sub = subscriber("s1", [{ action: "read", subject: "Project" }]);
      filter.register("Project:tenant:t1", sub);
      expect(filter.subscriberCount("Project:tenant:t1")).toBe(1);
    });

    it("register() is idempotent for the same socket on the same channel", () => {
      const filter = new ChannelFilter();
      const sub = subscriber("s1", [{ action: "read", subject: "Project" }]);
      filter.register("Project:tenant:t1", sub);
      filter.register("Project:tenant:t1", sub);
      expect(filter.subscriberCount("Project:tenant:t1")).toBe(1);
    });

    it("unregister() removes a single subscriber", () => {
      const filter = new ChannelFilter();
      const a = subscriber("a", [{ action: "read", subject: "Project" }]);
      const b = subscriber("b", [{ action: "read", subject: "Project" }]);
      filter.register("Project:tenant:t1", a);
      filter.register("Project:tenant:t1", b);
      filter.unregister("Project:tenant:t1", "a");
      expect(filter.subscriberCount("Project:tenant:t1")).toBe(1);
    });

    it("unregister() of an unknown socket is a no-op", () => {
      const filter = new ChannelFilter();
      filter.unregister("Project:tenant:t1", "ghost");
      expect(filter.subscriberCount("Project:tenant:t1")).toBe(0);
    });

    it("unregisterAll() drops every channel for a socket", () => {
      const filter = new ChannelFilter();
      const sub = subscriber("s1", [{ action: "read", subject: "Project" }]);
      filter.register("Project:tenant:t1", sub);
      filter.register("Project:item:abc", sub);
      filter.unregisterAll("s1");
      expect(filter.subscriberCount("Project:tenant:t1")).toBe(0);
      expect(filter.subscriberCount("Project:item:abc")).toBe(0);
    });
  });

  describe("broadcast()", () => {
    it("emits to subscribers whose ability allows read on the record", () => {
      const filter = new ChannelFilter();
      const sub = subscriber("s1", [{ action: "read", subject: "Project" }]);
      filter.register("Project:tenant:t1", sub);
      const delivered = filter.broadcast("Project:tenant:t1", "project.updated", {
        record: { id: "p1", tenantId: "t1", name: "X" },
      });
      expect(delivered).toBe(1);
      expect(sub.socket.received).toEqual([
        { event: "project.updated", payload: { record: { id: "p1", tenantId: "t1", name: "X" } } },
      ]);
    });

    it("skips subscribers whose conditions reject the record (tenant mismatch)", () => {
      const filter = new ChannelFilter();
      const sub = subscriber("s1", [
        { action: "read", subject: "Project", conditions: { tenantId: "t1" } },
      ]);
      filter.register("Project:tenant:t1", sub);
      const delivered = filter.broadcast("Project:tenant:t1", "project.updated", {
        record: { id: "p1", tenantId: "t2", name: "X" },
      });
      expect(delivered).toBe(0);
      expect(sub.socket.received).toHaveLength(0);
    });

    it("honours per-record conditions (ownerId match)", () => {
      const filter = new ChannelFilter();
      const owner = subscriber(
        "owner",
        [{ action: "read", subject: "Project", conditions: { ownerId: "u-owner" } }],
        { userId: "u-owner" },
      );
      const stranger = subscriber(
        "stranger",
        [{ action: "read", subject: "Project", conditions: { ownerId: "u-stranger" } }],
        { userId: "u-stranger" },
      );
      filter.register("Project:tenant:t1", owner);
      filter.register("Project:tenant:t1", stranger);
      const delivered = filter.broadcast("Project:tenant:t1", "project.updated", {
        record: { id: "p1", tenantId: "t1", ownerId: "u-owner" },
      });
      expect(delivered).toBe(1);
      expect(owner.socket.received).toHaveLength(1);
      expect(stranger.socket.received).toHaveLength(0);
    });

    it("emits nothing on a channel with no subscribers", () => {
      const filter = new ChannelFilter();
      const delivered = filter.broadcast("Project:tenant:t1", "project.updated", {
        record: { id: "p1", tenantId: "t1" },
      });
      expect(delivered).toBe(0);
    });

    it("routes broadcasts to the matching channel only (no cross-channel leak)", () => {
      const filter = new ChannelFilter();
      const onA = subscriber("a", [{ action: "read", subject: "Project" }]);
      const onB = subscriber("b", [{ action: "read", subject: "Project" }]);
      filter.register("Project:item:p1", onA);
      filter.register("Project:item:p2", onB);
      filter.broadcast("Project:item:p1", "project.updated", {
        record: { id: "p1", tenantId: "t1" },
      });
      expect(onA.socket.received).toHaveLength(1);
      expect(onB.socket.received).toHaveLength(0);
    });

    it("uses the channel subject as the CASL subject type so per-subject rules apply", () => {
      const filter = new ChannelFilter();
      const projectReader = subscriber("s1", [{ action: "read", subject: "Project" }]);
      // Same socket-shape but the rule grants no Asset rights — subscribing to
      // an Asset channel must not deliver Asset payloads.
      filter.register("Asset:tenant:t1", projectReader);
      const delivered = filter.broadcast("Asset:tenant:t1", "asset.updated", {
        record: { id: "a1", tenantId: "t1" },
      });
      expect(delivered).toBe(0);
      expect(projectReader.socket.received).toHaveLength(0);
    });

    it("rejects malformed channel names", () => {
      const filter = new ChannelFilter();
      expect(() => filter.broadcast("not-a-channel", "x", { record: {} })).toThrow(/malformed/);
    });
  });
});
