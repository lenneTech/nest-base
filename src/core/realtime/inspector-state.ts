/**
 * Realtime Inspector State.
 *
 * Pure in-memory tracker fed by `RealtimeGateway` (runner) and read by
 * the `/hub/admin/realtime*` JSON sidecars + the admin live-push namespace.
 * No I/O, no NestJS lifecycle — every method is a pure mutation that
 * the unit suite exercises without booting the app.
 *
 * Three datasets:
 *   1. Sockets — connect / disconnect / ping / bytes accounting.
 *   2. Channel registry — derived from per-socket subscription sets.
 *   3. Event ringbuffer — bounded log of recent dispatches with
 *      latency + recipient counts. Used both to power the "Events"
 *      tab and to compute per-channel aggregate counters.
 *
 * The ringbuffer is bounded so a long-running dev session never grows
 * the heap unbounded. Default bound: 500 events (acceptance criteria
 * for the Events tab is "last 500" client-side).
 */

export interface InspectorClock {
  /** Unix-ms timestamp; injected so unit tests run with a fake clock. */
  now: () => number;
  /** Maximum events kept in the ringbuffer. Default 500. */
  maxEvents?: number;
}

export interface SocketConnectInput {
  id: string;
  userId: string;
  tenantId: string;
  /** Optional UA string (UA-Parser surface lives in a follow-up issue). */
  userAgent?: string;
}

export interface InspectorEventInput {
  channel: string;
  eventType: string;
  payload: unknown;
  recipientCount: number;
  latencyMs: number;
}

export interface InspectorSocketSnapshot {
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

export interface InspectorEventSnapshot {
  channel: string;
  eventType: string;
  payload: unknown;
  recipientCount: number;
  latencyMs: number;
  occurredAt: string;
  occurredAtMs: number;
}

export interface InspectorChannelSnapshot {
  name: string;
  subscriberCount: number;
  subscriberIds: string[];
  eventsLastHour: number;
  p95LatencyMs: number;
}

interface SocketRecord {
  id: string;
  userId: string;
  tenantId: string;
  connectedAtMs: number;
  channels: Set<string>;
  lastPingMs?: number;
  bytesSent: number;
  bytesReceived: number;
  userAgent?: string;
}

const DEFAULT_MAX_EVENTS = 500;
const ONE_HOUR_MS = 60 * 60 * 1_000;
const FIVE_SECONDS_MS = 5_000;

export class InspectorState {
  private readonly now: () => number;
  private readonly maxEvents: number;
  private readonly sockets = new Map<string, SocketRecord>();
  private events: InspectorEventSnapshot[] = [];

  constructor(clock: InspectorClock) {
    this.now = clock.now;
    this.maxEvents = clock.maxEvents ?? DEFAULT_MAX_EVENTS;
  }

  // ── socket lifecycle ───────────────────────────────────────────

  recordConnect(input: SocketConnectInput): void {
    this.sockets.set(input.id, {
      id: input.id,
      userId: input.userId,
      tenantId: input.tenantId,
      connectedAtMs: this.now(),
      channels: new Set<string>(),
      bytesSent: 0,
      bytesReceived: 0,
      userAgent: input.userAgent,
    });
  }

  recordDisconnect(socketId: string): void {
    this.sockets.delete(socketId);
  }

  recordPing(socketId: string, latencyMs: number): void {
    const sock = this.sockets.get(socketId);
    if (!sock) return;
    sock.lastPingMs = latencyMs;
  }

  recordBytes(socketId: string, delta: { sent?: number; received?: number }): void {
    const sock = this.sockets.get(socketId);
    if (!sock) return;
    if (delta.sent) sock.bytesSent += delta.sent;
    if (delta.received) sock.bytesReceived += delta.received;
  }

  // ── channel registry ───────────────────────────────────────────

  recordSubscribe(socketId: string, channel: string): void {
    const sock = this.sockets.get(socketId);
    if (!sock) return;
    sock.channels.add(channel);
  }

  recordUnsubscribe(socketId: string, channel: string): void {
    const sock = this.sockets.get(socketId);
    if (!sock) return;
    sock.channels.delete(channel);
  }

  // ── event ringbuffer ───────────────────────────────────────────

  recordEvent(input: InspectorEventInput): InspectorEventSnapshot {
    const tMs = this.now();
    const snapshot: InspectorEventSnapshot = {
      channel: input.channel,
      eventType: input.eventType,
      payload: input.payload,
      recipientCount: input.recipientCount,
      latencyMs: input.latencyMs,
      occurredAt: new Date(tMs).toISOString(),
      occurredAtMs: tMs,
    };
    // Newest first — matches the UI's reverse-chronological display.
    this.events.unshift(snapshot);
    if (this.events.length > this.maxEvents) {
      this.events.length = this.maxEvents;
    }
    return snapshot;
  }

  // ── snapshots ──────────────────────────────────────────────────

  snapshotSockets(): InspectorSocketSnapshot[] {
    const result: InspectorSocketSnapshot[] = [];
    for (const sock of this.sockets.values()) {
      result.push(toSocketSnapshot(sock));
    }
    return result;
  }

  snapshotEvents(): InspectorEventSnapshot[] {
    return this.events.slice();
  }

  snapshotChannels(): InspectorChannelSnapshot[] {
    const subscribers = new Map<string, Set<string>>();
    for (const sock of this.sockets.values()) {
      for (const channel of sock.channels) {
        let set = subscribers.get(channel);
        if (!set) {
          set = new Set<string>();
          subscribers.set(channel, set);
        }
        set.add(sock.id);
      }
    }

    // Aggregate event stats per channel from the ringbuffer.
    const cutoff = this.now() - ONE_HOUR_MS;
    const perChannelLatencies = new Map<string, number[]>();
    const perChannelCounts = new Map<string, number>();
    for (const event of this.events) {
      if (event.occurredAtMs < cutoff) continue;
      perChannelCounts.set(event.channel, (perChannelCounts.get(event.channel) ?? 0) + 1);
      let lat = perChannelLatencies.get(event.channel);
      if (!lat) {
        lat = [];
        perChannelLatencies.set(event.channel, lat);
      }
      lat.push(event.latencyMs);
    }

    // Channels with subscribers always show up; channels seen only in
    // the event log (no subscribers) also show so the operator can see
    // dispatched-but-undelivered events.
    const allChannels = new Set<string>([...subscribers.keys(), ...perChannelCounts.keys()]);
    const result: InspectorChannelSnapshot[] = [];
    for (const name of allChannels) {
      const subs = subscribers.get(name) ?? new Set<string>();
      const lat = perChannelLatencies.get(name) ?? [];
      result.push({
        name,
        subscriberCount: subs.size,
        subscriberIds: Array.from(subs),
        eventsLastHour: perChannelCounts.get(name) ?? 0,
        p95LatencyMs: percentile(lat, 0.95),
      });
    }
    // Stable order: most subscribers, then alphabetic.
    result.sort((a, b) => b.subscriberCount - a.subscriberCount || a.name.localeCompare(b.name));
    return result;
  }

  /** 5-second sliding average of dispatched events per second. */
  eventsPerSecond(): number {
    const cutoff = this.now() - FIVE_SECONDS_MS;
    let count = 0;
    for (const event of this.events) {
      if (event.occurredAtMs >= cutoff) count++;
    }
    return count / 5;
  }

  /** Events on channels the socket is subscribed to. */
  eventsForSocket(socketId: string): InspectorEventSnapshot[] {
    const sock = this.sockets.get(socketId);
    if (!sock) return [];
    return this.events.filter((e) => sock.channels.has(e.channel));
  }
}

function toSocketSnapshot(sock: SocketRecord): InspectorSocketSnapshot {
  const out: InspectorSocketSnapshot = {
    id: sock.id,
    userId: sock.userId,
    tenantId: sock.tenantId,
    channels: Array.from(sock.channels),
    connectedAt: new Date(sock.connectedAtMs).toISOString(),
    bytesSent: sock.bytesSent,
    bytesReceived: sock.bytesReceived,
  };
  if (sock.lastPingMs !== undefined) out.lastPingMs = sock.lastPingMs;
  if (sock.userAgent !== undefined) out.userAgent = sock.userAgent;
  return out;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}
