import { describe, expect, it } from 'vitest';

import {
  fanoutMasterEvent,
  type WebhookSubscriber,
  type MasterEvent,
} from '../../src/core/webhooks/job-fanout.js';

/**
 * Story · Webhook Master/Sub-Job-Fanout (PLAN.md §28.4/#18).
 *
 * One Master-Job per event; the dispatcher splits it into one
 * Sub-Job per matching subscriber. Subscribers can scope by event
 * name (exact or wildcard) and by tenant.
 */
describe('Story · Webhook fanout', () => {
  function event(): MasterEvent {
    return {
      id: 'evt-1',
      tenantId: 't1',
      type: 'invoice.paid',
      payload: { amount: 100 },
      occurredAt: new Date(),
    };
  }

  it('emits one sub-job per matching subscriber', () => {
    const subs: WebhookSubscriber[] = [
      { id: 's1', tenantId: 't1', url: 'https://a', secret: 'k', events: ['invoice.paid'] },
      { id: 's2', tenantId: 't1', url: 'https://b', secret: 'k', events: ['invoice.paid'] },
    ];
    const jobs = fanoutMasterEvent(event(), subs);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.subscriberId).sort()).toEqual(['s1', 's2']);
  });

  it('skips subscribers with mismatched tenant', () => {
    const subs: WebhookSubscriber[] = [
      { id: 's1', tenantId: 't1', url: 'https://a', secret: 'k', events: ['invoice.paid'] },
      { id: 's2', tenantId: 'other', url: 'https://b', secret: 'k', events: ['invoice.paid'] },
    ];
    expect(fanoutMasterEvent(event(), subs).map((j) => j.subscriberId)).toEqual(['s1']);
  });

  it('skips subscribers that do not subscribe to the event type', () => {
    const subs: WebhookSubscriber[] = [
      { id: 's1', tenantId: 't1', url: 'https://a', secret: 'k', events: ['user.created'] },
      { id: 's2', tenantId: 't1', url: 'https://b', secret: 'k', events: ['invoice.paid'] },
    ];
    expect(fanoutMasterEvent(event(), subs).map((j) => j.subscriberId)).toEqual(['s2']);
  });

  it('honors `events: ["*"]` wildcard subscribers', () => {
    const subs: WebhookSubscriber[] = [
      { id: 's1', tenantId: 't1', url: 'https://a', secret: 'k', events: ['*'] },
    ];
    expect(fanoutMasterEvent(event(), subs)).toHaveLength(1);
  });

  it('honors `events: ["invoice.*"]` group wildcards', () => {
    const subs: WebhookSubscriber[] = [
      { id: 's1', tenantId: 't1', url: 'https://a', secret: 'k', events: ['invoice.*'] },
      { id: 's2', tenantId: 't1', url: 'https://b', secret: 'k', events: ['user.*'] },
    ];
    expect(fanoutMasterEvent(event(), subs).map((j) => j.subscriberId)).toEqual(['s1']);
  });

  it('returns [] for an event with no matching subscribers', () => {
    const subs: WebhookSubscriber[] = [
      { id: 's1', tenantId: 't1', url: 'https://a', secret: 'k', events: ['user.*'] },
    ];
    expect(fanoutMasterEvent(event(), subs)).toEqual([]);
  });

  it('each sub-job carries a stable jobKey for de-dup', () => {
    const subs: WebhookSubscriber[] = [
      { id: 's1', tenantId: 't1', url: 'https://a', secret: 'k', events: ['*'] },
    ];
    const a = fanoutMasterEvent(event(), subs)[0]!;
    const b = fanoutMasterEvent(event(), subs)[0]!;
    expect(a.jobKey).toBe(b.jobKey);
    expect(a.jobKey).toContain('evt-1');
    expect(a.jobKey).toContain('s1');
  });
});
