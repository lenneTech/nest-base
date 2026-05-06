/**
 * Webhook Master/Sub-Job-Fanout.
 *
 * One Master-Job per event; the dispatcher splits it into one
 * Sub-Job per matching subscriber. Subscribers can scope by event
 * name (exact / wildcard / group-wildcard) and by tenant.
 */

export interface MasterEvent {
  id: string;
  tenantId: string;
  type: string;
  payload: unknown;
  occurredAt: Date;
}

export interface WebhookSubscriber {
  id: string;
  tenantId: string;
  url: string;
  secret: string;
  /** Subscription pattern list — `*`, `<group>.*`, or exact `<group>.<name>`. */
  events: string[];
}

export interface SubJob {
  /** Stable de-dup key: `<eventId>::<subscriberId>`. */
  jobKey: string;
  subscriberId: string;
  url: string;
  secret: string;
  event: MasterEvent;
}

export function fanoutMasterEvent(event: MasterEvent, subscribers: WebhookSubscriber[]): SubJob[] {
  const jobs: SubJob[] = [];
  for (const sub of subscribers) {
    if (sub.tenantId !== event.tenantId) continue;
    if (!matchesEvent(sub.events, event.type)) continue;
    jobs.push({
      jobKey: `${event.id}::${sub.id}`,
      subscriberId: sub.id,
      url: sub.url,
      secret: sub.secret,
      event,
    });
  }
  return jobs;
}

export function matchesEvent(patterns: string[], type: string): boolean {
  for (const pattern of patterns) {
    if (pattern === "*") return true;
    if (pattern === type) return true;
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);
      if (type === prefix || type.startsWith(`${prefix}.`)) return true;
    }
  }
  return false;
}
