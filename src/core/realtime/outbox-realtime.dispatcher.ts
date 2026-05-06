import { Logger } from "@nestjs/common";

import type { OutboxEntry } from "../outbox/outbox.js";
import type { OutboxDispatcher } from "../outbox/outbox-worker.js";
import {
  type OutboxRealtimeRecord,
  type RealtimeEmission,
  planRealtimeEmission,
} from "./outbox-realtime.bridge.js";

/**
 * Realtime OutboxDispatcher (CF.RT.04).
 *
 * Wraps the iter-39 `outbox-realtime.bridge.ts` planner in an
 * `OutboxDispatcher` so the per-second outbox tick fans
 * `realtime.broadcast` entries out through the Socket.IO gateway.
 * Registered on `OUTBOX_DISPATCHERS` alongside webhook + search
 * dispatchers; the worker invokes every dispatcher per entry and
 * marks the entry processed only when ALL dispatchers succeed.
 *
 * Routing matrix (from the planner):
 *   - kind ≠ "realtime.broadcast"   → no-op (other dispatcher owns it)
 *   - scope: tenant                 → gateway.broadcast(`tenant:<id>`, …)
 *   - scope: user                   → gateway.broadcast(`user:<id>`, …)
 *   - scope: global                 → gateway.broadcastGlobal(…)
 *
 * Idempotency: at-least-once is the contract — the same entry can
 * fan out twice if a downstream dispatcher fails on the first pass
 * and the worker retries. Realtime broadcasts are inherently
 * fire-and-forget so duplicate emissions are tolerable; consumers
 * that need exactly-once semantics dedupe via a domain id in the
 * payload.
 */

export type RealtimeBroadcastTarget =
  | {
      readonly kind: "room";
      readonly room: string;
      readonly event: string;
      readonly payload: unknown;
    }
  | {
      readonly kind: "global";
      readonly event: string;
      readonly payload: unknown;
    };

export interface RealtimeBroadcaster {
  /** Send `event + payload` to every socket in `room`. */
  broadcast(room: string, event: string, payload: unknown): void;
  /** Send `event + payload` to every connected socket. */
  broadcastGlobal(event: string, payload: unknown): void;
}

export class RealtimeOutboxDispatcher implements OutboxDispatcher {
  readonly name = "realtime-outbox";
  private readonly log = new Logger("RealtimeOutboxDispatcher");

  constructor(private readonly gateway: RealtimeBroadcaster | null) {}

  async dispatch(entry: OutboxEntry): Promise<void> {
    const record: OutboxRealtimeRecord = {
      // Map OutboxEntry → OutboxRealtimeRecord. The entry's payload
      // carries channel + payload + scope; the entry's type carries
      // the kind discriminator.
      kind: entry.type,
      ...(entry.payload as Record<string, unknown>),
    };

    let emission: RealtimeEmission | null;
    try {
      emission = planRealtimeEmission(record);
    } catch (err) {
      this.log.warn(
        `realtime-outbox: dropping malformed broadcast entry id=${entry.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    if (emission === null) {
      // Non-realtime entry — dispatched by another consumer.
      return;
    }

    if (!this.gateway) {
      // Pre-Socket-server boot or test bootstrap without the gateway.
      // Emit a single warn line so an operator notices a misconfiguration
      // without flooding logs on every tick.
      this.log.warn(
        `realtime-outbox: gateway not available — dropping emission channel=${emission.channel}`,
      );
      return;
    }

    if (emission.room === null) {
      this.gateway.broadcastGlobal(emission.channel, emission.payload);
      return;
    }
    this.gateway.broadcast(emission.room, emission.channel, emission.payload);
  }
}
