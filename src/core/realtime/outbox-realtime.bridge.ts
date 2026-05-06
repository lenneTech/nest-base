/**
 * Outbox → Realtime bridge planner (CF.RT.04).
 *
 * The pg-boss outbox processor calls this planner once per record.
 * The planner decides whether the record should produce a Socket.IO
 * emission — and if so, which channel + room to target. The runner
 * (the realtime module's gateway) takes the planner's output and
 * issues the actual `gateway.to(room).emit(channel, payload)`.
 *
 * Why a planner: keeps the routing decision testable in isolation
 * from a live socket.io instance. Wraps the alt repo's
 * outbox-realtime bridge with a typed contract.
 *
 * Routing matrix:
 *   scope: tenant   → room = `tenant:<tenantId>`
 *   scope: user     → room = `user:<userId>`
 *   scope: global   → room = null (gateway broadcasts to all)
 *   kind ≠ realtime.broadcast → null (no emission)
 *
 * PII masking is intentionally NOT done here — the realtime filter
 * (CF.RT.11) owns payload sanitisation so masking stays consistent
 * across direct gateway emissions and outbox-driven ones.
 */

export type OutboxRealtimeRecord =
  | {
      readonly kind: "realtime.broadcast";
      readonly channel: string;
      readonly payload: unknown;
      readonly scope: RealtimeScope;
    }
  | {
      readonly kind: string;
      readonly [other: string]: unknown;
    };

export type RealtimeScope =
  | { readonly kind: "tenant"; readonly tenantId: string }
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "global" };

export interface RealtimeEmission {
  readonly channel: string;
  readonly payload: unknown;
  /** Socket.IO room name, or `null` for a global broadcast. */
  readonly room: string | null;
}

export class OutboxRealtimeBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxRealtimeBridgeError";
  }
}

export function planRealtimeEmission(record: OutboxRealtimeRecord): RealtimeEmission | null {
  if (record.kind !== "realtime.broadcast") {
    return null;
  }

  // After the kind check we can safely narrow to the broadcast variant.
  const broadcast = record as Extract<OutboxRealtimeRecord, { kind: "realtime.broadcast" }>;

  if (!broadcast.channel || broadcast.channel.trim() === "") {
    throw new OutboxRealtimeBridgeError("realtime.broadcast: channel must not be empty");
  }

  const room = roomFor(broadcast.scope);
  return {
    channel: broadcast.channel,
    payload: broadcast.payload,
    room,
  };
}

function roomFor(scope: RealtimeScope): string | null {
  switch (scope.kind) {
    case "tenant":
      return `tenant:${scope.tenantId}`;
    case "user":
      return `user:${scope.userId}`;
    case "global":
      return null;
  }
}
