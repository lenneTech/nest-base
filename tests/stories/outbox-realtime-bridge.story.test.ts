import { describe, expect, it } from "vitest";

/**
 * Story · Outbox → Realtime bridge planner (CF.RT.04).
 *
 * The PRD's `CF.RT.04` requires a bridge from the pg-boss outbox to
 * the Socket.IO realtime gateway. The job processor emits events that
 * the bridge translates into per-channel/room broadcasts.
 *
 * This slice owns the *pure mapping* — given an outbox record, return
 * the realtime emission contract: channel, event name, payload, and
 * (optionally) the room scoping. The actual `gateway.to(room).emit`
 * happens in the runner; the planner makes the routing decision
 * testable in isolation.
 *
 * Routing rules:
 *   - Outbox records with `kind: "realtime.broadcast"` produce one
 *     emission targeting the named channel.
 *   - Tenant-scoped events route to a per-tenant room (`tenant:<id>`)
 *     so the gateway's join-on-auth wiring naturally filters them.
 *   - User-scoped events route to a per-user room (`user:<id>`).
 *   - Globally-scoped events have no `room` (broadcast to all).
 *   - Unknown record kinds yield no emission (`null` planner output).
 *   - PII masking is delegated to the existing realtime filter
 *     (CF.RT.11) — the bridge does NOT mutate payloads.
 */
describe("Story · Outbox → Realtime bridge planner", () => {
  it("translates a tenant-scoped broadcast into a per-tenant room emission", async () => {
    const { planRealtimeEmission } =
      await import("../../src/core/realtime/outbox-realtime.bridge.js");
    const result = planRealtimeEmission({
      kind: "realtime.broadcast",
      channel: "files.created",
      payload: { fileId: "f1", name: "doc.pdf" },
      scope: { kind: "tenant", tenantId: "t1" },
    });
    expect(result).toEqual({
      channel: "files.created",
      payload: { fileId: "f1", name: "doc.pdf" },
      room: "tenant:t1",
    });
  });

  it("translates a user-scoped broadcast into a per-user room emission", async () => {
    const { planRealtimeEmission } =
      await import("../../src/core/realtime/outbox-realtime.bridge.js");
    const result = planRealtimeEmission({
      kind: "realtime.broadcast",
      channel: "notification.delivered",
      payload: { id: "n1" },
      scope: { kind: "user", userId: "u1" },
    });
    expect(result).toEqual({
      channel: "notification.delivered",
      payload: { id: "n1" },
      room: "user:u1",
    });
  });

  it("translates a global broadcast into a room-less emission", async () => {
    const { planRealtimeEmission } =
      await import("../../src/core/realtime/outbox-realtime.bridge.js");
    const result = planRealtimeEmission({
      kind: "realtime.broadcast",
      channel: "system.maintenance",
      payload: { startsAt: 1_700_000_000 },
      scope: { kind: "global" },
    });
    expect(result).toEqual({
      channel: "system.maintenance",
      payload: { startsAt: 1_700_000_000 },
      room: null,
    });
  });

  it("returns null for unknown record kinds", async () => {
    const { planRealtimeEmission } =
      await import("../../src/core/realtime/outbox-realtime.bridge.js");
    const result = planRealtimeEmission({
      kind: "email.send",
      to: "alice@example.com",
    });
    expect(result).toBeNull();
  });

  it("preserves the payload object (does not mutate)", async () => {
    const { planRealtimeEmission } =
      await import("../../src/core/realtime/outbox-realtime.bridge.js");
    const payload = { secret: "should-be-masked-by-CF.RT.11", count: 3 };
    const result = planRealtimeEmission({
      kind: "realtime.broadcast",
      channel: "evt",
      payload,
      scope: { kind: "tenant", tenantId: "t1" },
    });
    expect(result?.payload).toBe(payload);
  });

  it("rejects empty channel name (configuration error)", async () => {
    const { planRealtimeEmission } =
      await import("../../src/core/realtime/outbox-realtime.bridge.js");
    expect(() =>
      planRealtimeEmission({
        kind: "realtime.broadcast",
        channel: "",
        payload: {},
        scope: { kind: "global" },
      }),
    ).toThrow(/channel/i);
  });
});
