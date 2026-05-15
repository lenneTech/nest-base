import { EventEmitter } from "node:events";

import {
  Inject,
  Injectable,
  Logger,
  Module,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

const socketIoRedisLogger = new Logger("SocketIoRedisAdapter");

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
  type OnGatewayInit,
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
import { ConfigService } from "../config/config.service.js";
import { BetterAuthModule } from "../auth/better-auth.module.js";
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from "../auth/better-auth.token.js";
import { canSubscribeToChannel, parseChannelName } from "./channel-permission.js";
import { PermissionService } from "../permissions/permission.service.js";

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
/** Minimal session shape returned by BetterAuth's getSession() call. */
interface SessionLookup {
  user: { id: string; tenantId?: string | null };
  session?: { activeOrganizationId?: string | null };
}

@Injectable()
// `cors: { origin: true }` reflects every origin — replaced by an
// `afterInit` hook that reads allowed origins from ConfigService (H1 fix).
// We keep a permissive default here only so the gateway can start; the
// correct value is applied before any client can connect.
@WebSocketGateway({ cors: { origin: false } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger("RealtimeGateway");
  private readonly state = new InspectorState({ now: () => Date.now() });
  /** Bound socket-id → live socket reference, populated on real connections. */
  private readonly liveSockets = new Map<string, Socket>();

  constructor(
    private readonly inspectorBus: InspectorEvents,
    private readonly configService: ConfigService,
    @Optional()
    @Inject(BETTER_AUTH_INSTANCE)
    private readonly auth: BetterAuthInstance | null = null,
    @Optional()
    private readonly permissionService: PermissionService | null = null,
  ) {}

  /**
   * Apply the CORS config from `ConfigService` to the Socket.IO engine
   * immediately after the server is initialised. The `@WebSocketGateway`
   * decorator options are static (evaluated at decoration time), so we
   * cannot read runtime config there — `afterInit` runs before any
   * client can connect and is the correct hook (H1 fix).
   */
  afterInit(server: Server): void {
    const corsConfig = this.configService.cors;
    const allowedOrigins = corsConfig.allowedOrigins;
    // Use an explicit list when configured; fall back to false (deny all)
    // rather than reflecting every origin.
    const origin =
      allowedOrigins.length > 0
        ? (
            requestOrigin: string | undefined,
            callback: (err: Error | null, allow?: boolean) => void,
          ) => {
            callback(null, allowedOrigins.includes(requestOrigin ?? ""));
          }
        : false;
    server.engine.opts.cors = { origin, credentials: corsConfig.credentials };
    this.logger.log(
      `Socket.IO CORS configured: ${allowedOrigins.length > 0 ? allowedOrigins.join(", ") : "deny all"}`,
    );
  }

  handleConnection(client: Socket): void {
    // Fix 1.2 — Auth handshake: validate the Better-Auth session before
    // accepting the connection. The token can arrive either as a Bearer
    // token in `client.handshake.auth.token` (preferred — avoids cookie
    // CORS complexities) or as the cookie header for browser clients.
    // When neither is present and auth is configured, disconnect immediately.
    //
    // When `auth` is null (BetterAuth not configured, e.g. test bootstrap
    // without BETTER_AUTH_SECRET), accept connections so smoke tests and
    // dev environments without auth still work. Log a warning so operators
    // don't silently ship an unprotected gateway.
    if (!this.auth) {
      this.logger.warn(
        "RealtimeGateway: BetterAuth not configured — accepting connection without session validation",
      );
      // No ability passed: anonymous connections cannot subscribe to any
      // channel (canSubscribeToChannel defaults to deny when ability is null).
      this.acceptConnection(client, "anonymous", "anonymous");
      return;
    }

    // Resolve the auth handshake asynchronously. The socket stays
    // connected during the async check — handleConnection is sync, so we
    // kick off the validation and disconnect if it fails.
    void this.authenticateConnection(client);
  }

  private async authenticateConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    const cookieHeader = client.handshake.headers?.cookie;

    // Build a Fetch API Headers object for BetterAuth's getSession().
    const headers = new Headers();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }

    let session: SessionLookup | null = null;
    try {
      session = (await this.auth!.api.getSession({ headers })) as SessionLookup;
    } catch (err) {
      this.logger.debug?.(`socket ${client.id}: session lookup failed — ${(err as Error).message}`);
    }

    if (!session?.user) {
      // No valid session — reject the connection.
      this.logger.debug(`socket ${client.id}: disconnecting (no valid session)`);
      client.disconnect(true);
      return;
    }

    const userId = session.user.id;
    const tenantId =
      (session as { session?: { activeOrganizationId?: string | null } }).session
        ?.activeOrganizationId ??
      session.user.tenantId ??
      "";

    // Resolve CASL ability for this user/tenant so channel subscriptions
    // can be permission-checked synchronously in the subscribe listener.
    // If PermissionService is not wired (feature off / test bootstrap),
    // the ability stays undefined → all channel subscriptions will be
    // denied (secure default).
    let ability: import("../permissions/casl-ability.js").Ability | undefined;
    if (this.permissionService) {
      try {
        ability = await this.permissionService.abilityFor(userId, tenantId);
      } catch (err) {
        this.logger.debug?.(
          `socket ${client.id}: failed to resolve CASL ability — ${(err as Error).message}`,
        );
      }
    }

    this.acceptConnection(client, userId, tenantId, ability);
  }

  private acceptConnection(
    client: Socket,
    userId: string,
    tenantId: string,
    ability?: import("../permissions/casl-ability.js").Ability,
  ): void {
    this.liveSockets.set(client.id, client);
    // Store identity and CASL ability on the socket's data bag so the
    // subscribe listener can perform per-channel permission checks without
    // a second async lookup. The ability is resolved once per connection
    // and cached for the socket's lifetime.
    (client.data as Record<string, unknown>).ability = ability ?? null;
    this.state.recordConnect({ id: client.id, userId, tenantId });
    this.inspectorBus.emit(INSPECTOR_EVENT.socketConnected, { id: client.id, userId, tenantId });
    this.logger.debug(`socket connected: ${client.id} (userId=${userId})`);

    // Use `on` (not `once`) so a single connection can subscribe to
    // multiple channels over its lifetime. Listener cleanup happens
    // explicitly in handleDisconnect via removeAllListeners() — this
    // prevents accumulation of stale listeners on reconnects where
    // Socket.IO reuses the same Socket instance.
    client.on("subscribe", (channel: unknown) => {
      if (typeof channel !== "string" || !channel) return;
      // Channel permission check: parse the channel name and verify the
      // user's CASL ability allows subscription. A missing ability (no
      // PermissionService wired or anonymous connection) defaults to
      // deny-all — security posture favors explicit over permissive.
      let allowed = false;
      const storedAbility = (
        client.data as { ability?: import("../permissions/casl-ability.js").Ability | null }
      ).ability;
      if (storedAbility) {
        try {
          const parsed = parseChannelName(channel);
          allowed = canSubscribeToChannel(storedAbility, parsed);
        } catch {
          allowed = false;
        }
      }
      if (!allowed) return;
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
    this.logger.debug(`socket disconnected: ${client.id}`);
    // Explicitly remove the subscribe/unsubscribe listeners registered in
    // acceptConnection. Socket.IO may reuse socket instances on reconnect,
    // so omitting cleanup would accumulate duplicate listeners over time.
    client.removeAllListeners("subscribe");
    client.removeAllListeners("unsubscribe");
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
 * Minimal subset of the ioredis client surface that @socket.io/redis-adapter
 * requires. Avoids importing ioredis types directly — the adapter itself types
 * its parameters as `any`, so we only need enough to remove the `as never` cast
 * and keep TypeScript checking the properties we actually call (quit, duplicate).
 */
interface RedisAdapterClient {
  duplicate(): RedisAdapterClient;
  quit(): Promise<string>;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

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
    private readonly adapterPair: { pub: RedisAdapterClient; sub: RedisAdapterClient } | null,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.adapterPair) return;
    try {
      const { createAdapter } = await import("@socket.io/redis-adapter");
      if (this.gateway.server) {
        this.gateway.server.adapter(
          // createAdapter is typed with `any` parameters in @socket.io/redis-adapter;
          // casting through unknown satisfies TS without suppressing type checking on
          // the RedisAdapterClient interface we use throughout this class.
          createAdapter(this.adapterPair.pub as unknown, this.adapterPair.sub as unknown),
        );
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
      await this.adapterPair.pub.quit();
      await this.adapterPair.sub.quit();
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
async function resolveSocketIoRedisPair(): Promise<{
  pub: RedisAdapterClient;
  sub: RedisAdapterClient;
} | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { default: Redis } = await import("ioredis");
    const pub = new Redis(url) as unknown as RedisAdapterClient;
    const sub = pub.duplicate();
    // Prevent unhandled 'error' event crash on auth failures, network drops,
    // or TLS rejections. ioredis surfaces these via its internal retry logic;
    // commands reject individually instead of crashing the process.
    pub.on("error", (err: unknown) => {
      socketIoRedisLogger.error(
        `ioredis pub connection error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    sub.on("error", (err: unknown) => {
      socketIoRedisLogger.error(
        `ioredis sub connection error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return { pub, sub };
  } catch (err) {
    // Log the error so operators know the URL was malformed rather than
    // silently falling back to in-memory mode (Fix #7 companion).
    socketIoRedisLogger.error(
      `failed to create ioredis pair for Socket.IO adapter (URL: ${url ? url.replace(/:\/\/[^@]*@/, "://:***@") : "empty"}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

@Module({
  imports: [
    OutboxModule,
    // Fix 1.2: import BetterAuthModule so BETTER_AUTH_INSTANCE is resolvable
    // by RealtimeGateway for the WebSocket auth handshake. The @Optional()
    // decorator on the constructor parameter ensures the gateway still boots
    // when BETTER_AUTH_SECRET is not set (dev/test without auth).
    BetterAuthModule,
  ],
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
