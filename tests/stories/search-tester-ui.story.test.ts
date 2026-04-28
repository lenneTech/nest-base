import { describe, expect, it } from 'vitest';

import {
  renderSearchTesterPage,
  type SearchHit,
  type SearchTesterPageInput,
} from '../../src/core/dx/search-tester-ui.js';

/**
 * Story · Search-Tester UI (PLAN.md §27.1 + §32 Phase 8).
 *
 * Pure HTML renderer for the `/admin/search` page. The controller
 * runs the FTS query through CrossResourceSearchService (or a
 * single-resource search) and hands the hit list to this renderer
 * along with the query string and any tsquery / sanitisation
 * diagnostics.
 *
 * The renderer is a probing tool — admins type a query, hit Enter,
 * see the parsed tsquery and the result list. No JS-side state, no
 * partial loads.
 */
describe('Story · Search-Tester UI', () => {
  function input(overrides: Partial<SearchTesterPageInput> = {}): SearchTesterPageInput {
    return { hits: [], ...overrides };
  }

  function hit(overrides: Partial<SearchHit> = {}): SearchHit {
    return {
      resource: 'Project',
      id: 'p-1',
      title: 'Quarterly Plan',
      snippet: '… <b>Quarterly</b> plan for Q2 …',
      rank: 0.85,
      ...overrides,
    };
  }

  describe('document chrome', () => {
    it('emits a complete HTML document', () => {
      const html = renderSearchTesterPage(input());
      expect(html).toMatch(/^<!doctype html>/i);
      expect(html).toMatch(/<\/html>\s*$/);
    });

    it('uses "Search Tester" as the page title', () => {
      expect(renderSearchTesterPage(input())).toMatch(/<title>[^<]*Search Tester/);
    });

    it('includes a back-link to the Dev-Hub', () => {
      expect(renderSearchTesterPage(input())).toMatch(/href=["']\/dev["']/);
    });
  });

  describe('query form', () => {
    it('renders an input + submit', () => {
      const html = renderSearchTesterPage(input());
      expect(html).toMatch(/<form[^>]+method=["']get["']/);
      expect(html).toMatch(/<input[^>]+name=["']q["']/);
      expect(html).toMatch(/<button[^>]*>.*Search.*<\/button>/i);
    });

    it('echoes the submitted query into the input', () => {
      const html = renderSearchTesterPage(input({ query: 'budget approval' }));
      expect(html).toMatch(/value=["']budget approval["']/);
    });

    it('shows the parsed tsquery when provided', () => {
      const html = renderSearchTesterPage(input({ query: 'budget', tsquery: 'budget:*' }));
      expect(html).toContain('budget:*');
    });

    it('omits the tsquery hint when not provided', () => {
      const html = renderSearchTesterPage(input({ query: 'budget' }));
      expect(html).not.toMatch(/data-tsquery=/);
    });
  });

  describe('result list', () => {
    it('shows an idle empty state when no query has been run yet', () => {
      const html = renderSearchTesterPage(input());
      expect(html).toMatch(/enter.*query|type.*query|no query/i);
    });

    it('shows a "no results" state when the query returns zero hits', () => {
      const html = renderSearchTesterPage(input({ query: 'nothing-here', hits: [] }));
      expect(html).toMatch(/no results/i);
    });

    it('renders one row per hit with resource / id / title / rank', () => {
      const html = renderSearchTesterPage(
        input({
          query: 'plan',
          hits: [hit({ resource: 'Order', id: 'o-9', title: 'Order Plan', rank: 0.42 })],
        }),
      );
      expect(html).toContain('Order');
      expect(html).toContain('o-9');
      expect(html).toContain('Order Plan');
      expect(html).toMatch(/0\.42/);
    });

    it('renders the snippet with raw <b> tags preserved (FTS highlights)', () => {
      const html = renderSearchTesterPage(
        input({
          query: 'plan',
          hits: [hit({ snippet: 'Quarterly <b>plan</b> for Q2' })],
        }),
      );
      expect(html).toContain('<b>plan</b>');
    });

    it('preserves controller-decided ordering', () => {
      const html = renderSearchTesterPage(
        input({
          query: 'a',
          hits: [
            hit({ id: 'p-1', title: 'aaa-first' }),
            hit({ id: 'p-2', title: 'zzz-last' }),
          ],
        }),
      );
      expect(html.indexOf('aaa-first')).toBeLessThan(html.indexOf('zzz-last'));
    });

    it('shows the result count when hits are present', () => {
      const html = renderSearchTesterPage(
        input({ query: 'q', hits: [hit({ id: 'p-1' }), hit({ id: 'p-2' }), hit({ id: 'p-3' })] }),
      );
      expect(html).toMatch(/3.*result/i);
    });
  });

  describe('XSS safety', () => {
    it('escapes hit fields except snippet (FTS highlights are trusted)', () => {
      const malicious = '<img src=x onerror=alert(1)>';
      const html = renderSearchTesterPage(
        input({
          query: 'q',
          hits: [hit({ resource: malicious, id: malicious, title: malicious })],
        }),
      );
      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).toContain('&lt;img');
    });

    it('escapes the query echo so a hostile value cannot break the form', () => {
      const html = renderSearchTesterPage(input({ query: '"><script>1' }));
      expect(html).not.toContain('"><script>1');
      expect(html).toContain('&quot;&gt;&lt;script&gt;1');
    });
  });
});
