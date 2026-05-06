import type { Ability } from "../permissions/casl-ability.js";

/**
 * Realtime permission-aware channels.
 *
 * Channel naming convention: `<subject>:<scope>:<id>`
 *   `Project:item:abc`     — single project record
 *   `Project:tenant:t1`    — all projects in a tenant
 *   `User:item:u1`         — single user record
 *
 * The auth-handshake decides if a user may subscribe by reading the
 * cached Ability and matching the channel against the rule's
 * (action='read', subject) tuple. For `tenant`-scoped channels the
 * tenant id flows into the conditions match so cross-tenant
 * subscription leaks impossible.
 */

export interface ChannelDescriptor {
  subject: string;
  scope: string;
  id: string;
}

const CHANNEL_RE = /^([^:]+):([^:]+):([^:]+)$/;

export function parseChannelName(name: string): ChannelDescriptor {
  const match = CHANNEL_RE.exec(name);
  if (!match) throw new Error(`channel: malformed name "${name}"`);
  return { subject: match[1]!, scope: match[2]!, id: match[3]! };
}

export function canSubscribeToChannel(ability: Ability, channel: ChannelDescriptor): boolean {
  // CASL's `ability.can` accepts a `Subject` union that's tighter
  // than the project's stored channel descriptor. The wire-shape
  // helper below routes through CASL's typed signature once.
  type CanArgs = Parameters<Ability["can"]>;
  type CanSubject = CanArgs[1];
  if (channel.scope === "tenant") {
    // Use a synthetic subject that carries the tenant id so CASL's
    // mongoQueryMatcher can evaluate `conditions: { tenantId: <id> }`.
    const subject: CanSubject = {
      __caslSubjectType__: channel.subject,
      tenantId: channel.id,
    } as CanSubject;
    return ability.can("read", subject);
  }
  return ability.can("read", channel.subject as CanSubject);
}
