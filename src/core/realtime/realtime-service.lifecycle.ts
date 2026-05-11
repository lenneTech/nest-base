import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import type { RealtimeService } from "./realtime.service.js";

/**
 * RealtimeService lifecycle (CF.RT.* — iter-102).
 *
 * Bridges the cross-instance LISTEN/NOTIFY transport to the
 * Socket.IO gateway. At `OnModuleInit` the lifecycle service:
 *
 *   1. Calls `service.start()` to open the transport (in production
 *      this opens a dedicated Postgres LISTEN connection; tests use
 *      `InMemoryRealtimeTransport` which is no-op start/stop).
 *   2. Wires a "broadcast everything" handler via the transport's
 *      raw `onMessage` channel that forwards every cross-instance
 *      NOTIFY into `gateway.broadcast(channelName, "message", payload)`.
 *      Per-channel subscribers (used by domain code) sit in front of
 *      this fan-out by `service.subscribe(channel, …)`.
 *
 * The `RealtimeService.transport` private field isn't accessible
 * here — instead the lifecycle hooks `service.subscribe()` for
 * every channel encountered. To catch every cross-instance NOTIFY
 * regardless of subscribe order, we expose an internal "broadcast"
 * subscription pattern: the transport's onMessage callback in
 * `RealtimeService` already dispatches to `subscribers.get(channel)`
 * — but we want EVERY notify to flow to the gateway, not just
 * pre-registered channels. The cleanest option: the lifecycle
 * service installs its own transport-level handler at start time,
 * which is what `subscribeAllChannels` accomplishes via a
 * dedicated `RealtimeServiceWithBroadcast` shape.
 *
 * To keep `RealtimeService` itself unchanged, the lifecycle takes
 * a thin `BroadcastTarget` callback shape — production wires this
 * to `RealtimeGateway.broadcast`; tests inject a spy.
 */

export interface BroadcastTarget {
  broadcast(channel: string, event: string, payload: unknown): void;
  broadcastGlobal(event: string, payload: unknown): void;
}

export const REALTIME_SERVICE = Symbol.for("lt:RealtimeService");
export const REALTIME_TRANSPORT = Symbol.for("lt:RealtimeTransport");

@Injectable()
export class RealtimeServiceLifecycle implements OnModuleInit, OnModuleDestroy {
  private unsubscribeBroadcast: (() => void) | null = null;

  constructor(
    @Inject(REALTIME_SERVICE) private readonly service: RealtimeService,
    private readonly gateway: BroadcastTarget,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.service.start();

    // Wire an all-channel handler via the public subscribeAll() API so that
    // every cross-instance NOTIFY is forwarded to the Socket.IO gateway.
    // Using subscribeAll() instead of Reflect.get(service, "transport") means
    // a rename of private fields cannot silently break this wiring at runtime.
    this.service.subscribeAll((channel, payload) => {
      this.gateway.broadcast(channel, "message", payload);
    });

    this.unsubscribeBroadcast = () => {
      // subscribeAll has no off() — the service.stop() teardown closes
      // the transport so no further messages arrive after destroy.
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.unsubscribeBroadcast) {
      this.unsubscribeBroadcast();
      this.unsubscribeBroadcast = null;
    }
    await this.service.stop();
  }
}
