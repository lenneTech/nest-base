import { Logger, Module } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

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
 * `subscribe` event; the gateway runs the filter (placeholder noop
 * until the Ability resolver hooks into the session) before adding
 * the socket to the room.
 */
@WebSocketGateway({ cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger('RealtimeGateway');
  private readonly sockets = new Map<string, { userId?: string; rooms: Set<string> }>();

  handleConnection(client: Socket): void {
    this.sockets.set(client.id, { rooms: new Set() });
    this.logger.log(`socket connected: ${client.id}`);
    client.on('subscribe', (channel: unknown) => {
      if (typeof channel !== 'string' || !channel) return;
      // Permission-aware filter placeholder: every channel is allowed
      // for now. Once Ability resolution is wired into handshake auth,
      // the gateway calls `ChannelFilter.canSubscribe()` here.
      client.join(channel);
      const session = this.sockets.get(client.id);
      if (session) session.rooms.add(channel);
    });
    client.on('unsubscribe', (channel: unknown) => {
      if (typeof channel !== 'string' || !channel) return;
      client.leave(channel);
      const session = this.sockets.get(client.id);
      if (session) session.rooms.delete(channel);
    });
  }

  handleDisconnect(client: Socket): void {
    this.sockets.delete(client.id);
    this.logger.log(`socket disconnected: ${client.id}`);
  }

  /** Used by domain code to broadcast tenant/permission-filtered events. */
  broadcast(channel: string, event: string, payload: unknown): void {
    this.server.to(channel).emit(event, payload);
  }

  activeSocketCount(): number {
    return this.sockets.size;
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
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
