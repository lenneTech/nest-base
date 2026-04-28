/**
 * Realtime Service (PLAN.md §12 + §32 Phase 5).
 *
 * Each server instance listens on a Postgres connection;
 * `pg_notify(channel, payload)` from any instance triggers a
 * `LISTEN` message that this service routes to local subscribers
 * (Socket.IO sockets, server-side handlers).
 *
 * Production wires `PostgresRealtimeTransport`; the unit suite uses
 * `InMemoryRealtimeTransport` that mirrors the same surface.
 */

export type RealtimeMessageHandler = (channel: string, payload: unknown) => void;

export interface RealtimeTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  notify(channel: string, payload: unknown): Promise<void>;
  /** Wire a single handler that receives every cross-instance NOTIFY. */
  onMessage(handler: RealtimeMessageHandler): void;
}

export type Subscriber = (payload: unknown) => void;
export type Unsubscribe = () => void;

export class RealtimeService {
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private running = false;
  private pending: Array<Promise<void>> = [];

  constructor(private readonly transport: RealtimeTransport) {
    this.transport.onMessage((channel, payload) => {
      this.dispatchLocal(channel, payload);
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    await this.transport.start();
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    await this.flush();
    await this.transport.stop();
    this.running = false;
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    if (!this.running) {
      throw new Error('realtime: publish() called before start()');
    }
    await this.transport.notify(channel, payload);
  }

  subscribe(channel: string, callback: Subscriber): Unsubscribe {
    let set = this.subscribers.get(channel);
    if (!set) {
      set = new Set();
      this.subscribers.set(channel, set);
    }
    set.add(callback);
    return () => {
      const current = this.subscribers.get(channel);
      if (!current) return;
      current.delete(callback);
      if (current.size === 0) this.subscribers.delete(channel);
    };
  }

  /** Test-only helper: await every dispatched-but-not-yet-finished callback. */
  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const drain = this.pending.slice();
    this.pending = [];
    await Promise.all(drain);
  }

  private dispatchLocal(channel: string, payload: unknown): void {
    const set = this.subscribers.get(channel);
    if (!set) return;
    for (const callback of set) {
      try {
        const result: unknown = callback(payload);
        if (result instanceof Promise) {
          this.pending.push(result.catch(() => {}));
        }
      } catch {
        // Swallowed by design — one bad subscriber must not stop siblings.
      }
    }
  }
}

export class InMemoryRealtimeTransport implements RealtimeTransport {
  private handler: RealtimeMessageHandler | null = null;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async notify(channel: string, payload: unknown): Promise<void> {
    // Mirror the loopback that Postgres NOTIFY exhibits — the same
    // instance receives its own NOTIFY back through LISTEN.
    this.handler?.(channel, payload);
  }

  onMessage(handler: RealtimeMessageHandler): void {
    this.handler = handler;
  }

  /** Test helper: simulate an inbound NOTIFY from a different instance. */
  simulateIncoming(channel: string, payload: unknown): void {
    this.handler?.(channel, payload);
  }
}
