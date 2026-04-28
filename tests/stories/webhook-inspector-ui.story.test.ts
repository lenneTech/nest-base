import { describe, expect, it } from 'vitest';

import {
  renderWebhookInspectorPage,
  type WebhookInspectorPageInput,
  type DeliveryListEntry,
} from '../../src/core/dx/webhook-inspector-ui.js';

/**
 * Story · Webhook-Inspector UI (PLAN.md §27.1 + §32 Phase 8).
 *
 * Pure HTML renderer for the `/admin/webhooks` page. The controller
 * loads recent deliveries through the existing webhook dispatcher's
 * delivery store, lets the admin filter / re-trigger, and hands the
 * result list to this renderer.
 *
 * The renderer treats the inspector's list view as its own read
 * model — extending the dispatcher's `DeliveryRecord` would force a
 * shared shape on two surfaces with different requirements (the
 * dispatcher just needs persistence; the inspector needs human-
 * friendly fields like timestamps and error excerpts).
 */
describe('Story · Webhook-Inspector UI', () => {
  function input(overrides: Partial<WebhookInspectorPageInput> = {}): WebhookInspectorPageInput {
    return {
      deliveries: [],
      ...overrides,
    };
  }

  function entry(overrides: Partial<DeliveryListEntry> = {}): DeliveryListEntry {
    return {
      id: 'd1',
      endpointId: 'ep-1',
      eventType: 'user.created',
      status: 'DELIVERED',
      statusCode: 200,
      attemptCount: 1,
      occurredAt: '2026-04-28T12:00:00Z',
      ...overrides,
    };
  }

  describe('document chrome', () => {
    it('emits a complete HTML document', () => {
      const html = renderWebhookInspectorPage(input());
      expect(html).toMatch(/^<!doctype html>/i);
      expect(html).toMatch(/<\/html>\s*$/);
    });

    it('includes a back-link to the Dev-Hub', () => {
      expect(renderWebhookInspectorPage(input())).toMatch(/href=["']\/dev["']/);
    });

    it('uses "Webhook Inspector" as the page title', () => {
      expect(renderWebhookInspectorPage(input())).toMatch(/<title>[^<]*Webhook Inspector/);
    });
  });

  describe('empty state', () => {
    it('shows an empty-state message when no deliveries are passed', () => {
      const html = renderWebhookInspectorPage(input({ deliveries: [] }));
      expect(html).toMatch(/no.*deliver/i);
    });

    it('does not render the deliveries table when empty', () => {
      const html = renderWebhookInspectorPage(input({ deliveries: [] }));
      expect(html).not.toMatch(/<table[^>]*data-deliveries/);
    });
  });

  describe('list rendering', () => {
    it('lists each delivery in a table row', () => {
      const html = renderWebhookInspectorPage(
        input({
          deliveries: [
            entry({ id: 'd-aa', eventType: 'user.created', status: 'DELIVERED' }),
            entry({ id: 'd-bb', eventType: 'order.placed', status: 'FAILED' }),
          ],
        }),
      );
      expect(html).toContain('user.created');
      expect(html).toContain('order.placed');
      expect(html).toMatch(/data-deliveries=["']true["']/);
    });

    it('marks failed deliveries with a status attribute the CSS can hook', () => {
      const html = renderWebhookInspectorPage(
        input({ deliveries: [entry({ status: 'FAILED', statusCode: 500 })] }),
      );
      expect(html).toMatch(/data-status=["']FAILED["']/);
    });

    it('shows the attempt count', () => {
      const html = renderWebhookInspectorPage(
        input({ deliveries: [entry({ attemptCount: 4 })] }),
      );
      expect(html).toContain('4');
    });

    it('renders error message when present', () => {
      const html = renderWebhookInspectorPage(
        input({ deliveries: [entry({ status: 'FAILED', errorMessage: 'connection refused' })] }),
      );
      expect(html).toContain('connection refused');
    });
  });

  describe('re-deliver action', () => {
    it('renders a re-deliver form per delivery posting to the deliveryId', () => {
      const html = renderWebhookInspectorPage(
        input({ deliveries: [entry({ id: 'd-redeliver-me' })] }),
      );
      expect(html).toMatch(/<form[^>]+method=["']post["'][^>]+action=["'][^"']*d-redeliver-me\/redeliver/i);
    });

    it('includes a hidden CSRF token field when one is provided', () => {
      const html = renderWebhookInspectorPage(
        input({ deliveries: [entry()], csrfToken: 'tok-123' }),
      );
      expect(html).toMatch(/<input[^>]+name=["']csrf["'][^>]+value=["']tok-123["']/);
    });

    it('omits the CSRF field when no token is provided (caller decides)', () => {
      const html = renderWebhookInspectorPage(input({ deliveries: [entry()] }));
      expect(html).not.toMatch(/name=["']csrf["']/);
    });
  });

  describe('status filter', () => {
    it('renders a filter dropdown with All / Delivered / Failed', () => {
      const html = renderWebhookInspectorPage(input());
      expect(html).toMatch(/<select[^>]+name=["']status["']/);
      expect(html).toContain('Delivered');
      expect(html).toContain('Failed');
    });

    it('marks the current filter as selected', () => {
      const html = renderWebhookInspectorPage(input({ filter: { status: 'FAILED' } }));
      expect(html).toMatch(/<option[^>]+value=["']FAILED["'][^>]+selected/i);
    });
  });

  describe('XSS safety', () => {
    it('escapes endpointId / eventType / errorMessage', () => {
      const malicious = '<img src=x onerror=alert(1)>';
      const html = renderWebhookInspectorPage(
        input({
          deliveries: [
            entry({
              endpointId: malicious,
              eventType: malicious,
              errorMessage: malicious,
            }),
          ],
        }),
      );
      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).toContain('&lt;img');
    });

    it('escapes the CSRF token (a hostile value cannot break the page)', () => {
      const html = renderWebhookInspectorPage(
        input({ deliveries: [entry()], csrfToken: '"><script>1' }),
      );
      expect(html).not.toContain('"><script>1');
      expect(html).toContain('&quot;&gt;&lt;script&gt;1');
    });
  });

  describe('ordering', () => {
    it('preserves the input order (the controller decides the ordering)', () => {
      const html = renderWebhookInspectorPage(
        input({
          deliveries: [
            entry({ id: 'd-1', eventType: 'aaa' }),
            entry({ id: 'd-2', eventType: 'zzz' }),
            entry({ id: 'd-3', eventType: 'mmm' }),
          ],
        }),
      );
      const aaaPos = html.indexOf('aaa');
      const zzzPos = html.indexOf('zzz');
      const mmmPos = html.indexOf('mmm');
      expect(aaaPos).toBeLessThan(zzzPos);
      expect(zzzPos).toBeLessThan(mmmPos);
    });
  });
});
