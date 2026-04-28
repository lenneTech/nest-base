import { parseChannelName } from './channel-permission.js';
import type { SocketClient, SocketSession } from './socket-gateway.js';

/**
 * Permission-Aware Channel-Filter (PLAN.md §12 + §32 Phase 5).
 *
 * SocketGateway gates *who joins a room*; this filter gates *what each
 * subscriber receives once a broadcast lands*. The two layers run the
 * same CASL ability — first against the channel's subject string,
 * then against the broadcast's record (so `conditions: { tenantId }`,
 * `{ ownerId }`, … apply per event).
 *
 * Pure in-memory: subscriber sets are local to the process. Cross-
 * instance fan-out happens through Postgres NOTIFY (RealtimeService);
 * each instance then filters its own subscribers here.
 */

export interface ChannelSubscriber {
  socket: SocketClient;
  session: SocketSession;
}

export interface ChannelBroadcastPayload {
  record: object;
}

export class ChannelFilter {
  private readonly subscribers = new Map<string, Map<string, ChannelSubscriber>>();

  register(channelName: string, sub: ChannelSubscriber): void {
    let channel = this.subscribers.get(channelName);
    if (!channel) {
      channel = new Map();
      this.subscribers.set(channelName, channel);
    }
    channel.set(sub.socket.id, sub);
  }

  unregister(channelName: string, socketId: string): void {
    const channel = this.subscribers.get(channelName);
    if (!channel) return;
    channel.delete(socketId);
    if (channel.size === 0) this.subscribers.delete(channelName);
  }

  unregisterAll(socketId: string): void {
    for (const [name, channel] of this.subscribers) {
      channel.delete(socketId);
      if (channel.size === 0) this.subscribers.delete(name);
    }
  }

  subscriberCount(channelName: string): number {
    return this.subscribers.get(channelName)?.size ?? 0;
  }

  broadcast(channelName: string, event: string, payload: ChannelBroadcastPayload): number {
    const descriptor = parseChannelName(channelName);
    const channel = this.subscribers.get(channelName);
    if (!channel || channel.size === 0) return 0;
    const subject = { __caslSubjectType__: descriptor.subject, ...payload.record };
    let delivered = 0;
    for (const sub of channel.values()) {
      if (sub.session.ability.can('read', subject as never)) {
        sub.socket.emit(event, payload);
        delivered++;
      }
    }
    return delivered;
  }
}
