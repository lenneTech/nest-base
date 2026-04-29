import type { Ability } from "../permissions/casl-ability.js";
import { canSubscribeToChannel, parseChannelName } from "./channel-permission.js";

/**
 * Socket.IO Gateway (PLAN.md §12 + §32 Phase 5).
 *
 * Three concerns glued together:
 *   1. Auth-handshake — connecting socket presents a token; the
 *      injected SessionResolver returns {userId, tenantId, ability}
 *      or null. A null result throws HandshakeFailedError.
 *   2. Room subscriptions — `subscribe()` runs the permission check
 *      from `canSubscribeToChannel()` and joins the socket to the
 *      room only when the ability allows.
 *   3. Dispatch — `dispatch(channel, event, payload)` emits to every
 *      joined socket through the abstract SocketServer adapter.
 *
 * The Socket.IO library binding lives in the realtime-module wiring;
 * tests use a stub SocketServer so the unit suite stays free of the
 * network layer.
 */

export class HandshakeFailedError extends Error {
  constructor(reason: string) {
    super(`socket-gateway: handshake failed (${reason})`);
    this.name = "HandshakeFailedError";
  }
}

export class PermissionDeniedError extends Error {
  constructor(channel: string) {
    super(`socket-gateway: permission denied for channel "${channel}"`);
    this.name = "PermissionDeniedError";
  }
}

export interface SocketSession {
  userId: string;
  tenantId: string;
  ability: Ability;
}

export interface SessionResolver {
  resolve(token: string): Promise<SocketSession | null>;
}

export interface SocketClient {
  id: string;
  join(room: string): void;
  leave(room: string): void;
  emit(event: string, payload: unknown): void;
}

export interface SocketServer {
  emitTo(room: string, event: string, payload: unknown): void;
}

export class SocketGateway {
  constructor(
    private readonly server: SocketServer,
    private readonly resolver: SessionResolver,
  ) {}

  async handshake(token: string): Promise<SocketSession> {
    if (!token) throw new HandshakeFailedError("empty token");
    const session = await this.resolver.resolve(token);
    if (!session) throw new HandshakeFailedError("unknown token");
    return session;
  }

  async subscribe(
    socket: SocketClient,
    session: SocketSession,
    channelName: string,
  ): Promise<void> {
    const channel = parseChannelName(channelName);
    if (!canSubscribeToChannel(session.ability, channel)) {
      throw new PermissionDeniedError(channelName);
    }
    socket.join(channelName);
  }

  unsubscribe(socket: SocketClient, channelName: string): void {
    socket.leave(channelName);
  }

  dispatch(channel: string, event: string, payload: unknown): void {
    this.server.emitTo(channel, event, payload);
  }
}
