import { describe, expect, it } from "vitest";

import {
  renderAuditBrowserPage,
  type AuditBrowserPageInput,
  type AuditLogEntry,
} from "../../src/core/dx/audit-browser-ui.js";

/**
 * Story · Audit-Browser UI.
 *
 * Pure HTML renderer for the `/admin/audit` page. The controller
 * loads audit-log entries (filtered + paginated server-side) and
 * hands the result to this renderer along with the filter state.
 *
 * The renderer's read-model — `AuditLogEntry` — keeps its own
 * shape so the audit-log persistence module can evolve
 * independently. before/after diffs are rendered as line-prefixed
 * snippets so the page stays JS-free.
 */
describe("Story · Audit-Browser UI", () => {
  function input(overrides: Partial<AuditBrowserPageInput> = {}): AuditBrowserPageInput {
    return { entries: [], filter: {}, ...overrides };
  }

  function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
    return {
      id: "a-1",
      action: "update",
      resource: "Project",
      resourceId: "p-1",
      actorUserId: "u-1",
      tenantId: "t-1",
      occurredAt: "2026-04-28T12:00:00Z",
      before: { name: "old" },
      after: { name: "new" },
      ...overrides,
    };
  }

  describe("document chrome", () => {
    it("emits a complete HTML document", () => {
      const html = renderAuditBrowserPage(input());
      expect(html).toMatch(/^<!doctype html>/i);
      expect(html).toMatch(/<\/html>\s*$/);
    });

    it('uses "Audit Browser" as the page title', () => {
      expect(renderAuditBrowserPage(input())).toMatch(/<title>[^<]*Audit Browser/);
    });

    it("includes a back-link to the Dev-Hub", () => {
      expect(renderAuditBrowserPage(input())).toMatch(/href=["']\/dev["']/);
    });
  });

  describe("filter form", () => {
    it("renders inputs for action, resource, actor, and date range", () => {
      const html = renderAuditBrowserPage(input());
      expect(html).toMatch(/<form[^>]+method=["']get["']/);
      expect(html).toMatch(/name=["']action["']/);
      expect(html).toMatch(/name=["']resource["']/);
      expect(html).toMatch(/name=["']actorUserId["']/);
      expect(html).toMatch(/name=["']from["']/);
      expect(html).toMatch(/name=["']to["']/);
    });

    it("echoes the active filter back into the inputs", () => {
      const html = renderAuditBrowserPage(
        input({
          filter: {
            action: "delete",
            resource: "Project",
            actorUserId: "u-42",
            from: "2026-04-01",
            to: "2026-04-30",
          },
        }),
      );
      expect(html).toMatch(/value=["']delete["']/);
      expect(html).toMatch(/value=["']Project["']/);
      expect(html).toMatch(/value=["']u-42["']/);
      expect(html).toMatch(/value=["']2026-04-01["']/);
      expect(html).toMatch(/value=["']2026-04-30["']/);
    });
  });

  describe("entries list", () => {
    it("shows an empty state when no entries match", () => {
      expect(renderAuditBrowserPage(input({ entries: [] }))).toMatch(/no.*audit.*entr/i);
    });

    it("renders one row per entry with timestamp / action / resource / actor", () => {
      const html = renderAuditBrowserPage(
        input({
          entries: [
            entry({
              action: "create",
              resource: "Order",
              resourceId: "o-7",
              actorUserId: "u-9",
              occurredAt: "2026-04-28T09:00:00Z",
            }),
          ],
        }),
      );
      expect(html).toContain("create");
      expect(html).toContain("Order");
      expect(html).toContain("o-7");
      expect(html).toContain("u-9");
      expect(html).toContain("2026-04-28T09:00:00Z");
    });

    it("marks delete actions with a status hook", () => {
      const html = renderAuditBrowserPage(input({ entries: [entry({ action: "delete" })] }));
      expect(html).toMatch(/data-action=["']delete["']/);
    });

    it("preserves controller-decided ordering", () => {
      const html = renderAuditBrowserPage(
        input({
          entries: [
            entry({ id: "a-aa", resourceId: "aaa-id" }),
            entry({ id: "a-zz", resourceId: "zzz-id" }),
          ],
        }),
      );
      expect(html.indexOf("aaa-id")).toBeLessThan(html.indexOf("zzz-id"));
    });
  });

  describe("diff view", () => {
    it("renders before/after as a side-by-side line diff for update entries", () => {
      const html = renderAuditBrowserPage(
        input({
          entries: [
            entry({
              action: "update",
              before: { name: "old", desc: "same" },
              after: { name: "new", desc: "same" },
            }),
          ],
        }),
      );
      expect(html).toContain("-");
      expect(html).toContain("+");
      expect(html).toMatch(/&quot;name&quot;: &quot;old&quot;/);
      expect(html).toMatch(/&quot;name&quot;: &quot;new&quot;/);
    });

    it("omits the diff block when there is nothing to compare (create with no before)", () => {
      const html = renderAuditBrowserPage(
        input({
          entries: [entry({ action: "create", before: undefined, after: { name: "fresh" } })],
        }),
      );
      expect(html).not.toContain('"name": "old"');
      expect(html).toMatch(/&quot;name&quot;: &quot;fresh&quot;/);
    });

    it("omits the diff block when after is missing (delete)", () => {
      const html = renderAuditBrowserPage(
        input({
          entries: [entry({ action: "delete", before: { name: "gone" }, after: undefined })],
        }),
      );
      expect(html).toMatch(/&quot;name&quot;: &quot;gone&quot;/);
    });
  });

  describe("XSS safety", () => {
    it("escapes resource / actorUserId / resourceId / payload values", () => {
      const malicious = "<img src=x onerror=alert(1)>";
      const html = renderAuditBrowserPage(
        input({
          entries: [
            entry({
              resource: malicious,
              resourceId: malicious,
              actorUserId: malicious,
              before: { evil: malicious },
              after: { evil: malicious },
            }),
          ],
        }),
      );
      expect(html).not.toContain("<img src=x onerror=alert(1)>");
      expect(html).toContain("&lt;img");
    });

    it("escapes filter values echoed back into the form", () => {
      const html = renderAuditBrowserPage(input({ filter: { action: '"><script>1' } }));
      expect(html).not.toContain('"><script>1');
      expect(html).toContain("&quot;&gt;&lt;script&gt;1");
    });
  });
});
