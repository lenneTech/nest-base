/**
 * Read-model types for the `/admin/realtime*` page.
 *
 * Shared between the JSON sidecars in `admin-spa.controller.ts` and the
 * React page. Keeps the contract typed end-to-end.
 *
 * The legacy "preview-only" entries (`payloadPreview`) survive as a
 * convenience for the bottom-of-page Recent-Events table; the upgraded
 * Events tab uses the richer `RealtimeEventDetail` shape with full
 * (masked) payload + recipient count + dispatch latency.
 */

export interface ActiveSocketEntry {
  id: string;
  userId: string;
  tenantId: string;
  channels: string[];
  connectedAt: string;
  lastPingMs?: number;
  bytesSent: number;
  bytesReceived: number;
  userAgent?: string;
}

export interface RealtimeEventEntry {
  channel: string;
  eventType: string;
  payloadPreview: string;
  occurredAt: string;
}

export interface RealtimeEventDetail {
  channel: string;
  eventType: string;
  payload: unknown;
  recipientCount: number;
  latencyMs: number;
  occurredAt: string;
}

export interface RealtimeChannelEntry {
  name: string;
  subscriberCount: number;
  subscriberIds: string[];
  eventsLastHour: number;
  p95LatencyMs: number;
}

export interface RealtimeInspectorPageInput {
  sockets: ActiveSocketEntry[];
  /** Aggregated channel registry (with subscribers, events, p95 latency). */
  channels: RealtimeChannelEntry[];
  /** Backwards-compatible recent-events list (payload preview only). */
  events: RealtimeEventEntry[];
  /** Detailed event ringbuffer (masked payloads, full dispatch metadata). */
  eventsDetailed: RealtimeEventDetail[];
  /** 5-second sliding average of dispatched events per second. */
  eventsPerSecond: number;
  refreshSeconds?: number;
}

export interface RealtimeChannelsPageInput {
  channels: RealtimeChannelEntry[];
}

/** Body for `POST /admin/realtime/sockets/:id/send`. */
export interface RealtimeSendInput {
  eventType: string;
  payload: unknown;
}

/** Body for `POST /admin/realtime/events/replay`. */
export interface RealtimeReplayInput {
  channel: string;
  eventType: string;
  payload: unknown;
}
