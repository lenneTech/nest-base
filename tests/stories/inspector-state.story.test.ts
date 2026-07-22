import { describe, expect, it } from "vitest";

import { InspectorState } from "../../src/core/realtime/inspector-state.js";

/**
 * Story · Realtime Inspector State.
 *
 * The inspector tracks three things in memory: connected sockets,
 * channel subscriptions (which sockets are joined to which channel),
 * and a ringbuffer of recently-dispatched events. The state is fed
 * by `RealtimeGateway` (runner) and is read by the `/hub/admin/realtime*`
 * JSON sidecars and the admin live-push namespace (also runners).
 *
 * The class itself is pure — no NestJS, no I/O — so the unit suite
 * exercises every aggregation and lifecycle without booting an app.
 */
describe("Story · Inspector State", () => {
  function makeNow(initial = 0): { now: () => number; advance(ms: number): void } {
    let t = initial;
    return {
      now: () => t,
      advance(ms) {
        t += ms;
      },
    };
  }

  describe("socket lifecycle", () => {
    it("recordConnect() inserts a socket entry", () => {
      const clock = makeNow(1_000);
      const state = new InspectorState({ now: clock.now });
      state.recordConnect({ id: "s1", userId: "u1", tenantId: "t1", userAgent: "ua" });
      const sockets = state.snapshotSockets();
      expect(sockets).toHaveLength(1);
      expect(sockets[0]).toMatchObject({
        id: "s1",
        userId: "u1",
        tenantId: "t1",
        userAgent: "ua",
        channels: [],
      });
      expect(sockets[0]!.connectedAt).toBe(new Date(1_000).toISOString());
    });

    it("recordDisconnect() removes the socket entry", () => {
      const state = new InspectorState({ now: () => 0 });
      state.recordConnect({ id: "s1", userId: "u1", tenantId: "t1" });
      state.recordDisconnect("s1");
      expect(state.snapshotSockets()).toHaveLength(0);
    });

    it("recordDisconnect() drops every channel registration for that socket", () => {
      const state = new InspectorState({ now: () => 0 });
      state.recordConnect({ id: "s1", userId: "u1", tenantId: "t1" });
      state.recordSubscribe("s1", "Project:tenant:t1");
      state.recordSubscribe("s1", "Asset:tenant:t1");
      state.recordDisconnect("s1");
      const channels = state.snapshotChannels();
      expect(channels).toHaveLength(0);
    });

    it("recordPing() updates the latest ping latency on the socket", () => {
      const state = new InspectorState({ now: () => 0 });
      state.recordConnect({ id: "s1", userId: "u1", tenantId: "t1" });
      state.recordPing("s1", 42);
      expect(state.snapshotSockets()[0]!.lastPingMs).toBe(42);
    });

    it("recordPing() on an unknown socket is a no-op", () => {
      const state = new InspectorState({ now: () => 0 });
      state.recordPing("ghost", 10);
      expect(state.snapshotSockets()).toHaveLength(0);
    });

    it("recordBytes() accumulates bytes-sent / bytes-received", () => {
      const state = new InspectorState({ now: () => 0 });
      state.recordConnect({ id: "s1", userId: "u1", tenantId: "t1" });
      state.recordBytes("s1", { sent: 100, received: 50 });
      state.recordBytes("s1", { sent: 25, received: 10 });
      const sock = state.snapshotSockets()[0]!;
      expect(sock.bytesSent).toBe(125);
      expect(sock.bytesReceived).toBe(60);
    });

    it("recordBytes() on an unknown socket is a no-op", () => {
      const state = new InspectorState({ now: () => 0 });
      state.recordBytes("ghost", { sent: 100, received: 50 });
      expect(state.snapshotSockets()).toHaveLength(0);
    });
  });

  describe("channel registry", () => {
    it("recordSubscribe() adds the channel to the socket's subscription set", () => {
      const state = new InspectorState({ now: () => 0 });
      state.recordConnect({ id: "s1", userId: "u1", tenantId: "t1" });
      state.recordSubscribe("s1", "Project:tenant:t1");
      const sock = state.snapshotSockets()[0]!;
      expect(sock.channels).toEqual(["Project:tenant:t1"]);
    });

    it("recordUnsubscribe() removes only the matching channel", () => {
      const state = new InspectorState({ now: () => 0 });
      state.recordConnect({ id: "s1", userId: "u1", tenantId: "t1" });
      state.recordSubscribe("s1", "Project:tenant:t1");
      state.recordSubscribe("s1", "Asset:tenant:t1");
      state.recordUnsubscribe("s1", "Project:tenant:t1");
      const sock = state.snapshotSockets()[0]!;
      expect(sock.channels).toEqual(["Asset:tenant:t1"]);
    });

    it("recordSubscribe() on an unknown socket is a no-op", () => {
      const state = new InspectorState({ now: () => 0 });
      state.recordSubscribe("ghost", "X:tenant:t1");
      expect(state.snapshotChannels()).toHaveLength(0);
    });

    it("recordUnsubscribe() on an unknown socket is a no-op", () => {
      const state = new InspectorState({ now: () => 0 });
      state.recordUnsubscribe("ghost", "X:tenant:t1");
      expect(state.snapshotChannels()).toHaveLength(0);
    });

    it("snapshotChannels() aggregates subscribers across sockets", () => {
      const state = new InspectorState({ now: () => 0 });
      state.recordConnect({ id: "s1", userId: "u1", tenantId: "t1" });
      state.recordConnect({ id: "s2", userId: "u2", tenantId: "t1" });
      state.recordSubscribe("s1", "Project:tenant:t1");
      state.recordSubscribe("s2", "Project:tenant:t1");
      const channels = state.snapshotChannels();
      const project = channels.find((c) => c.name === "Project:tenant:t1");
      expect(project).toBeDefined();
      expect(project!.subscriberCount).toBe(2);
      expect(project!.subscriberIds).toEqual(expect.arrayContaining(["s1", "s2"]));
    });
  });

  describe("event ringbuffer", () => {
    it("recordEvent() appends to the buffer with channel/type/payload/recipientCount", () => {
      const clock = makeNow(2_000);
      const state = new InspectorState({ now: clock.now });
      state.recordEvent({
        channel: "Project:tenant:t1",
        eventType: "project.updated",
        payload: { id: "p1" },
        recipientCount: 3,
        latencyMs: 12,
      });
      const events = state.snapshotEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        channel: "Project:tenant:t1",
        eventType: "project.updated",
        payload: { id: "p1" },
        recipientCount: 3,
        latencyMs: 12,
        occurredAt: new Date(2_000).toISOString(),
      });
    });

    it("ringbuffer is bounded by maxEvents (default 500)", () => {
      const state = new InspectorState({ now: () => 0, maxEvents: 3 });
      for (let i = 0; i < 5; i++) {
        state.recordEvent({
          channel: "X:tenant:t1",
          eventType: "x.dispatched",
          payload: { i },
          recipientCount: 1,
          latencyMs: 0,
        });
      }
      const events = state.snapshotEvents();
      expect(events).toHaveLength(3);
      // Newest first
      expect((events[0]!.payload as { i: number }).i).toBe(4);
      expect((events[2]!.payload as { i: number }).i).toBe(2);
    });

    it("recordEvent() updates per-channel aggregate counters", () => {
      const clock = makeNow(0);
      const state = new InspectorState({ now: clock.now });
      state.recordConnect({ id: "s1", userId: "u1", tenantId: "t1" });
      state.recordSubscribe("s1", "Project:tenant:t1");
      state.recordEvent({
        channel: "Project:tenant:t1",
        eventType: "project.updated",
        payload: { id: "p1" },
        recipientCount: 1,
        latencyMs: 10,
      });
      state.recordEvent({
        channel: "Project:tenant:t1",
        eventType: "project.updated",
        payload: { id: "p2" },
        recipientCount: 1,
        latencyMs: 20,
      });
      const project = state.snapshotChannels().find((c) => c.name === "Project:tenant:t1")!;
      expect(project.eventsLastHour).toBe(2);
      expect(project.p95LatencyMs).toBeGreaterThanOrEqual(10);
    });

    it("eventsPerSecond() reports a 5-second sliding average", () => {
      const clock = makeNow(0);
      const state = new InspectorState({ now: clock.now });
      // 10 events over 5 seconds => 2/sec
      for (let i = 0; i < 10; i++) {
        state.recordEvent({
          channel: "X:tenant:t1",
          eventType: "x",
          payload: {},
          recipientCount: 1,
          latencyMs: 0,
        });
        clock.advance(500);
      }
      const eps = state.eventsPerSecond();
      expect(eps).toBeGreaterThan(0);
      expect(eps).toBeLessThanOrEqual(10);
    });

    it("snapshotChannels() includes channels seen only in events (no subscribers)", () => {
      const clock = makeNow(0);
      const state = new InspectorState({ now: clock.now });
      state.recordEvent({
        channel: "Ghost:tenant:t1",
        eventType: "x",
        payload: {},
        recipientCount: 0,
        latencyMs: 5,
      });
      const channels = state.snapshotChannels();
      const ghost = channels.find((c) => c.name === "Ghost:tenant:t1");
      expect(ghost).toBeDefined();
      expect(ghost!.subscriberCount).toBe(0);
      expect(ghost!.eventsLastHour).toBe(1);
    });

    it("snapshotChannels() drops events older than one hour from the eventsLastHour count", () => {
      const clock = makeNow(0);
      const state = new InspectorState({ now: clock.now });
      state.recordConnect({ id: "s1", userId: "u1", tenantId: "t1" });
      state.recordSubscribe("s1", "X:tenant:t1");
      state.recordEvent({
        channel: "X:tenant:t1",
        eventType: "x",
        payload: {},
        recipientCount: 1,
        latencyMs: 0,
      });
      // Advance past the hour cutoff.
      clock.advance(2 * 60 * 60 * 1000);
      const x = state.snapshotChannels().find((c) => c.name === "X:tenant:t1")!;
      expect(x.eventsLastHour).toBe(0);
      // Subscribers still tracked.
      expect(x.subscriberCount).toBe(1);
    });

    it("eventsPerSecond() returns 0 when no recent events", () => {
      const clock = makeNow(0);
      const state = new InspectorState({ now: clock.now });
      // Older than 5 seconds.
      state.recordEvent({
        channel: "X:tenant:t1",
        eventType: "x",
        payload: {},
        recipientCount: 1,
        latencyMs: 0,
      });
      clock.advance(60_000);
      expect(state.eventsPerSecond()).toBe(0);
    });
  });

  describe("eventsForSocket()", () => {
    it("returns the events on channels the socket is subscribed to", () => {
      const state = new InspectorState({ now: () => 0 });
      state.recordConnect({ id: "s1", userId: "u1", tenantId: "t1" });
      state.recordSubscribe("s1", "Project:tenant:t1");
      state.recordEvent({
        channel: "Project:tenant:t1",
        eventType: "project.updated",
        payload: { id: "p1" },
        recipientCount: 1,
        latencyMs: 0,
      });
      state.recordEvent({
        channel: "Asset:tenant:t1",
        eventType: "asset.updated",
        payload: { id: "a1" },
        recipientCount: 0,
        latencyMs: 0,
      });
      const events = state.eventsForSocket("s1");
      expect(events).toHaveLength(1);
      expect(events[0]!.channel).toBe("Project:tenant:t1");
    });

    it("returns an empty array for an unknown socket", () => {
      const state = new InspectorState({ now: () => 0 });
      expect(state.eventsForSocket("ghost")).toEqual([]);
    });
  });
});
