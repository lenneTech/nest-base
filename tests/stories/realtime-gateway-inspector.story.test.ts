import { describe, expect, it, beforeEach } from "vitest";

import {
  InspectorEvents,
  RealtimeGateway,
  INSPECTOR_EVENT,
} from "../../src/core/realtime/realtime.module.js";

/**
 * Story · RealtimeGateway — inspector integration.
 *
 * The gateway is the runner that turns Socket.IO lifecycle events into
 * `InspectorState` mutations + `InspectorEvents` emissions. The admin
 * live-push namespace and the `/hub/admin/realtime*.json` controllers
 * read from the resulting state.
 *
 * The unit suite drives the gateway via its test-only entry points
 * (`recordTestSocket`, `disconnectSocket`, `sendToSocket`,
 * `replayEvent`) so the assertions exercise every code path without
 * booting socket.io.
 */
describe("Story · RealtimeGateway · Inspector integration", () => {
  let gateway: RealtimeGateway;
  let bus: InspectorEvents;
  let received: Array<{ event: string; payload: unknown }>;

  beforeEach(() => {
    bus = new InspectorEvents();
    received = [];
    for (const eventName of Object.values(INSPECTOR_EVENT)) {
      bus.on(eventName, (payload: unknown) => received.push({ event: eventName, payload }));
    }
    gateway = new RealtimeGateway(bus);
  });

  it("recordTestSocket() registers a socket and emits socket.connected on the bus", () => {
    gateway.recordTestSocket({ id: "s1", userId: "u1", tenantId: "t1" });
    const snapshot = gateway.inspectorSnapshot();
    expect(snapshot.sockets).toHaveLength(1);
    expect(snapshot.sockets[0]!.id).toBe("s1");
    expect(received.find((r) => r.event === INSPECTOR_EVENT.socketConnected)).toBeDefined();
  });

  it("hasSocket() reflects the registry", () => {
    expect(gateway.hasSocket("s1")).toBe(false);
    gateway.recordTestSocket({ id: "s1", userId: "u1", tenantId: "t1" });
    expect(gateway.hasSocket("s1")).toBe(true);
  });

  it("disconnectSocket() removes the socket and returns true on hit", () => {
    gateway.recordTestSocket({ id: "s1", userId: "u1", tenantId: "t1" });
    expect(gateway.disconnectSocket("s1")).toBe(true);
    expect(gateway.inspectorSnapshot().sockets).toHaveLength(0);
    expect(received.find((r) => r.event === INSPECTOR_EVENT.socketDisconnected)).toBeDefined();
  });

  it("disconnectSocket() returns false on an unknown socket", () => {
    expect(gateway.disconnectSocket("ghost")).toBe(false);
  });

  it("sendToSocket() returns true when the socket exists (no live binding required)", () => {
    gateway.recordTestSocket({ id: "s1", userId: "u1", tenantId: "t1" });
    expect(gateway.sendToSocket("s1", "debug.ping", { hi: 1 })).toBe(true);
  });

  it("sendToSocket() returns false on an unknown socket", () => {
    expect(gateway.sendToSocket("ghost", "x", {})).toBe(false);
  });

  it("broadcast() records the event with the masked payload + recipient count", () => {
    gateway.recordTestSocket({ id: "s1", userId: "u1", tenantId: "t1" });
    gateway.broadcast("Project:tenant:t1", "project.updated", {
      id: "p1",
      password: "topsecret",
    });
    const snapshot = gateway.inspectorSnapshot();
    expect(snapshot.events).toHaveLength(1);
    const event = snapshot.events[0]!;
    expect(event.eventType).toBe("project.updated");
    expect((event.payload as Record<string, unknown>).password).toBe("[redacted]");
    expect(received.find((r) => r.event === INSPECTOR_EVENT.eventDispatched)).toBeDefined();
  });

  it("replayEvent() reuses broadcast() so the inspector logs the replay too", () => {
    gateway.replayEvent("Project:tenant:t1", "project.updated", { id: "p1" });
    const snapshot = gateway.inspectorSnapshot();
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]!.eventType).toBe("project.updated");
  });

  it("inspectorSnapshot() exposes sockets / channels / events / eventsPerSecond", () => {
    gateway.recordTestSocket({ id: "s1", userId: "u1", tenantId: "t1" });
    gateway.broadcast("X:tenant:t1", "x.dispatched", { ok: 1 });
    const snapshot = gateway.inspectorSnapshot();
    expect(snapshot.sockets).toHaveLength(1);
    expect(Array.isArray(snapshot.channels)).toBe(true);
    expect(Array.isArray(snapshot.events)).toBe(true);
    expect(typeof snapshot.eventsPerSecond).toBe("number");
  });
});
