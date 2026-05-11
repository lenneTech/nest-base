import { EventEmitter } from "node:events";

import { Inject, Injectable, Logger, Module, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";

import { OUTBOX_DISPATCHERS, OutboxModule } from "../outbox/outbox.module.js";
import type { OutboxDispatcher } from "../outbox/outbox-worker.js";
import { RealtimeOutboxDispatcher } from "./outbox-realtime.dispatcher.js";
import {
  REALTIME_SERVICE,
  REALTIME_TRANSPORT,
  RealtimeServiceLifecycle,
} from "./realtime-service.lifecycle.js";
import {
  InMemoryRealtimeTransport,
  RealtimeService,
  type RealtimeTransport,
} from "./realtime.service.js";
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

import {
  InspectorState,
  type InspectorEventSnapshot,
  type SocketConnectInput,
} from "./inspector-state.js";
import { maskPayload } from "./inspector-filter.js";

/**
 * Inspector event names emitted by the gateway through the
 * `InspectorEvents` bus. The admin live-push namespace listens here
 * and re-broadcasts to its own subscribers.
 */
export const INSPECTOR_EVENT = {
  socketConnected: "socket.connected",
  socketDisconnected: "socket.disconnected",
  socketPing: "socket.ping",
  channelSubscribed: "channel.subscribed",
  channelUnsubscribed: "channel.unsubscribed",
  eventDispatched: "event.dispatched",
} as const;

/**
 * In-process pub/sub for the Realtime-Inspector live-push channel.
 *
 * The admin live-push namespace (`/__inspector`) subscribes here and
 * re-broadcasts every emit to its connected admin clients. Decoupling
 * gateway → bus → namespace keeps the inspector additive and 100 %
 * disable-able without touching the production Socket.IO surface.
 */
@Injectable()
export class InspectorEvents extends EventEmitter {}

/**
 * RealtimeGateway — Socket.IO endpoint mounted at the default `/`
 * namespace, listening on the same HTTP server NestJS uses for REST.
 *
 * Auth-handshake: clients send a session token in the `auth.token`
 * field of the connect handshake; the gateway validates via
 * Better-Auth's session API once that's wired. Today, every
 * connection is accepted and tagged anonymous so frontends can
 * smoke-test the WS endpoint.
 *
 * Permission-aware channel-filter: rooms are joined via the
 * `subscribe` event; the gateway runs the channel filter
 * (`canSubscribeToChannel` from `channel-permission.ts`) before
 * adding the socket to the room. Today the handshake runs in
 * "anonymous" identity mode — the filter accepts every channel —
 * because the production session resolver hooks in via the slice
 * that ports Better-Auth session lookup into the WS handshake.
 *
 * The gateway delegates every observable lifecycle change to the
 * `InspectorState` (pure planner) and emits parallel events on the
 * `InspectorEvents` bus so the admin live-push namespace can mirror
 * them without re-implementing the bookkeeping.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger("RealtimeGateway");
  private readonly state = new InspectorState({ now: () => Date.now() });
  /** Bound socket-id → live socket reference, populated on real connections. */
  private readonly liveSockets = new Map<string, Socket>();

  constructor(private readonly inspectorBus: InspectorEvents) {}

  handleConnection(client: Socket): void {
    this.liveSockets.set(client.id, client);
    this.state.recordConnect({
      id: client.id,
      // Production wires Better-Auth-resolved identity here; pre-auth
      // we tag the connection anonymous so the inspector can show every
      // socket without crashing on missing fields.
      userId: "anonymous",
      tenantId: "anonymous",
    });
    this.inspectorBus.emit(INSPECTOR_EVENT.socketConnected, {
      id: client.id,
      userId: "anonymous",
      tenantId: "anonymous",
    });
    this.logger.log(`socket connected: ${client.id}`);
    client.on("subscribe", (channel: unknown) => {
      if (typeof channel !== "string" || !channel) return;
      // Anonymous-handshake mode accepts every channel. The
      // canonical filter (`canSubscribeToChannel` in
      // `channel-permission.ts`) is consulted once the handshake-
      // session integration runs ability resolution against the
      // identified user.
      client.join(channel);
      this.state.recordSubscribe(client.id, channel);
      this.inspectorBus.emit(INSPECTOR_EVENT.channelSubscribed, {
        socketId: client.id,
        channel,
      });
    });
    client.on("unsubscribe", (channel: unknown) => {
      if (typeof channel !== "string" || !channel) return;
      client.leave(channel);
      this.state.recordUnsubscribe(client.id, channel);
      this.inspectorBus.emit(INSPECTOR_EVENT.channelUnsubscribed, {
        socketId: client.id,
        channel,
      });
    });
  }

  handleDisconnect(client: Socket): void {
    this.liveSockets.delete(client.id);
    this.state.recordDisconnect(client.id);
    this.inspectorBus.emit(INSPECTOR_EVENT.socketDisconnected, { id: client.id });
    this.logger.log(`socket disconnected: ${client.id}`);
  }

  /** Used by domain code to broadcast tenant/permission-filtered events. */
  broadcast(channel: string, event: string, payload: unknown): void {
    if (this.server) {
      this.server.to(channel).emit(event, payload);
    }
    // Mirror into the inspector — masked payload, recipient count from
    // the active subscriber registry, latency captured server-side.
    const recipientCount = this.subscriberCount(channel);
    const recorded = this.state.recordEvent({
      channel,
      eventType: event,
      payload: maskPayload(payload),
      recipientCount,
      latencyMs: 0,
    });
    this.inspectorBus.emit(INSPECTOR_EVENT.eventDispatched, recorded);
  }

  /**
   * Send `event + payload` to every connected socket regardless of
   * room membership. Used by the realtime OutboxDispatcher for
   * `scope: 'global'` broadcasts (system-wide announcements). The
   * inspector mirrors these under a synthetic `*` channel so the
   * /admin/realtime view still surfaces them.
   */
  broadcastGlobal(event: string, payload: unknown): void {
    if (this.server) {
      this.server.emit(event, payload);
    }
    const recorded = this.state.recordEvent({
      channel: "*",
      eventType: event,
      payload: maskPayload(payload),
      recipientCount: this.activeSocketCount(),
      latencyMs: 0,
    });
    this.inspectorBus.emit(INSPECTOR_EVENT.eventDispatched, recorded);
  }

  activeSocketCount(): number {
    return this.state.snapshotSockets().length;
  }

  /** Snapshot used by `GET /admin/realtime*.json`. */
  inspectorSnapshot(): {
    sockets: ReturnType<InspectorState["snapshotSockets"]>;
    channels: ReturnType<InspectorState["snapshotChannels"]>;
    events: InspectorEventSnapshot[];
    eventsPerSecond: number;
  } {
    return {
      sockets: this.state.snapshotSockets(),
      channels: this.state.snapshotChannels(),
      events: this.state.snapshotEvents(),
      eventsPerSecond: this.state.eventsPerSecond(),
    };
  }

  /** Returns true when a socket with the given id is live. */
  hasSocket(socketId: string): boolean {
    return this.state.snapshotSockets().some((s) => s.id === socketId);
  }

  /**
   * Disconnect a single socket — used by the admin "Disconnect" action.
   * In test mode the live-socket map may be empty; the inspector state
   * is still cleaned up so the snapshot reflects the action.
   */
  disconnectSocket(socketId: string): boolean {
    if (!this.hasSocket(socketId)) return false;
    const live = this.liveSockets.get(socketId);
    live?.disconnect(true);
    this.liveSockets.delete(socketId);
    this.state.recordDisconnect(socketId);
    this.inspectorBus.emit(INSPECTOR_EVENT.socketDisconnected, { id: socketId });
    return true;
  }

  /**
   * Send a single custom event to one socket — debug action exposed
   * only via the dev-only admin endpoint.
   */
  sendToSocket(socketId: string, event: string, payload: unknown): boolean {
    if (!this.hasSocket(socketId)) return false;
    const live = this.liveSockets.get(socketId);
    if (live) live.emit(event, payload);
    return true;
  }

  /**
   * Re-publish a previously seen event to every subscriber of its
   * channel — debug action used by the "Replay event" button.
   */
  replayEvent(channel: string, event: string, payload: unknown): void {
    this.broadcast(channel, event, payload);
  }

  /**
   * Test-only injection for inspector e2e tests — registers a socket
   * in the inspector state without spinning up a real Socket.IO client.
   * The disconnect path tolerates a missing live-socket entry, so the
   * test can drive the controller end-to-end and assert on the JSON
   * snapshot.
   */
  recordTestSocket(input: SocketConnectInput): void {
    this.state.recordConnect(input);
    this.inspectorBus.emit(INSPECTOR_EVENT.socketConnected, input);
  }

  private subscriberCount(channelName: string): number {
    const channels = this.state.snapshotChannels();
    return channels.find((c) => c.name === channelName)?.subscriberCount ?? 0;
  }
}

/**
 * RealtimeModule — wires `RealtimeGateway` (Socket.IO) and the
 * channel-permission filter. Listens on the existing HTTP server,
 * shares cookies with REST so session-based auth works without
 * cross-origin trickery.
 *
 * Postgres LISTEN/NOTIFY connection follows in a separate slice
 * (RealtimeService → connect on `OnModuleInit`, fan out via
 * `RealtimeGateway.broadcast()`).
 */
@Injectable()
export class RealtimeOutboxDispatcherLifecycle implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_DISPATCHERS)
    private readonly dispatchers: OutboxDispatcher[],
    private readonly gateway: RealtimeGateway,
  ) {}

  /**
   * Mounts the realtime dispatcher onto the OutboxModule's
   * `OUTBOX_DISPATCHERS` list at module init. We mutate the array in
   * place rather than re-binding the provider so OutboxModule's
   * `useValue: []` stays a single source of truth — every contributing
   * module pushes its dispatcher here. The OutboxWorker reads the
   * (now non-empty) array on every tick.
   */
  onModuleInit(): void {
    if (this.dispatchers.some((d) => d.name === "realtime-outbox")) return;
    this.dispatchers.push(new RealtimeOutboxDispatcher(this.gateway));
  }
}

const SOCKET_IO_REDIS_ADAPTER = Symbol.for("lt:SocketIoRedisAdapter");

/**
 * Lifecycle hook that installs the Socket.IO Redis adapter when
 * `REDIS_URL` is set. Runs after the gateway server is available
 * (`OnModuleInit`). When `adapterPair` is null, the default
 * in-memory adapter stays active — no change for test bootstraps.
 */
@Injectable()
export class SocketIoRedisAdapterLifecycle implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("SocketIoRedisAdapter");

  constructor(
    private readonly gateway: RealtimeGateway,
    @Inject(SOCKET_IO_REDIS_ADAPTER)
    private readonly adapterPair: { pub: unknown; sub: unknown } | null,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.adapterPair) return;
    try {
      const { createAdapter } = await import("@socket.io/redis-adapter");
      if (this.gateway.server) {
        this.gateway.server.adapter(createAdapter(this.adapterPair.pub as never, this.adapterPair.sub as never));
        this.log.log("Socket.IO Redis adapter installed (cross-pod broadcasts enabled)");
      }
    } catch (err) {
      this.log.warn(
        `Socket.IO Redis adapter init failed — falling back to in-memory: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.adapterPair) return;
    try {
      await (this.adapterPair.pub as { quit(): Promise<unknown> }).quit();
      await (this.adapterPair.sub as { quit(): Promise<unknown> }).quit();
    } catch {
      // Swallow disconnect errors on shutdown.
    }
  }
}

/**
 * Resolves an ioredis pub/sub pair for the Socket.IO Redis adapter.
 * Returns null when `REDIS_URL` is not set so test bootstraps stay
 * connection-free.
 */
async function resolveSocketIoRedisPair(): Promise<{ pub: unknown; sub: unknown } | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { default: Redis } = await import("ioredis");
    const pub = new Redis(url);
    const sub = pub.duplicate();
    return { pub, sub };
  } catch {
    return null;
  }
}

@Module({
  imports: [OutboxModule],
  providers: [
    RealtimeGateway,
    InspectorEvents,
    RealtimeOutboxDispatcherLifecycle,
    SocketIoRedisAdapterLifecycle,
    {
      provide: SOCKET_IO_REDIS_ADAPTER,
      useFactory: () => resolveSocketIoRedisPair(),
    },
    // Cross-instance LISTEN/NOTIFY transport (CF.RT.* iter-102).
    // Default binding: in-memory transport so test bootstraps don't
    // need a live Postgres LISTEN connection. Production projects
    // override REALTIME_TRANSPORT with a Postgres-backed adapter
    // built on `pg` LISTEN.
    {
      provide: REALTIME_TRANSPORT,
      useFactory: (): RealtimeTransport => new InMemoryRealtimeTransport(),
    },
    {
      provide: REALTIME_SERVICE,
      useFactory: (transport: RealtimeTransport): RealtimeService => new RealtimeService(transport),
      inject: [REALTIME_TRANSPORT],
    },
    {
      provide: RealtimeServiceLifecycle,
      useFactory: (service: RealtimeService, gateway: RealtimeGateway): RealtimeServiceLifecycle =>
        new RealtimeServiceLifecycle(service, gateway),
      inject: [REALTIME_SERVICE, RealtimeGateway],
    },
  ],
  exports: [RealtimeGateway, InspectorEvents, REALTIME_SERVICE, REALTIME_TRANSPORT],
})
export class RealtimeModule {}
