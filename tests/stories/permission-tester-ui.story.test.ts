import { describe, expect, it } from "vitest";

import {
  renderPermissionTesterPage,
  type PermissionTesterPageInput,
} from "../../src/core/dx/permission-tester-ui.js";
import type { PermissionReport } from "../../src/core/permissions/permission-report.js";

/**
 * Story · Permission-Tester UI (PLAN.md §27.1 + §32 Phase 8).
 *
 * Pure HTML renderer for the `/admin/permissions/test` page. The
 * controller calls this function with the request input and (when a
 * lookup ran) the resulting PermissionReport; the rendered string is
 * returned to the browser.
 *
 * Keeping the renderer pure means we can verify the page shape — and
 * the XSS-safe escaping — without booting NestJS, SSR runtimes, or a
 * browser.
 */
describe("Story · Permission-Tester UI", () => {
  function input(overrides: Partial<PermissionTesterPageInput> = {}): PermissionTesterPageInput {
    return {
      ...overrides,
    };
  }

  function report(overrides: Partial<PermissionReport> = {}): PermissionReport {
    return {
      userId: "u1",
      tenantId: "t1",
      byResource: {},
      ...overrides,
    };
  }

  describe("the form", () => {
    it("always renders an input form so the admin can test a different user", () => {
      const html = renderPermissionTesterPage(input());
      expect(html).toMatch(/<form[^>]+method=["']get["'][^>]*>/i);
      expect(html).toMatch(/name=["']userId["']/);
      expect(html).toMatch(/name=["']tenantId["']/);
      expect(html).toMatch(/<button[^>]*>.*Test.*<\/button>/i);
    });

    it("echoes submitted values back into the form (so the admin sees what they typed)", () => {
      const html = renderPermissionTesterPage(
        input({ submitted: { userId: "u-42", tenantId: "t-7" } }),
      );
      expect(html).toMatch(/value=["']u-42["']/);
      expect(html).toMatch(/value=["']t-7["']/);
    });
  });

  describe("result section", () => {
    it("shows nothing extra when no report is attached", () => {
      const html = renderPermissionTesterPage(input());
      expect(html).not.toMatch(/<table[^>]*data-permission-report/);
    });

    it("renders the userId and tenantId of the report", () => {
      const html = renderPermissionTesterPage(
        input({ report: report({ userId: "u-42", tenantId: "t-7" }) }),
      );
      expect(html).toContain("u-42");
      expect(html).toContain("t-7");
    });

    it("lists every resource with its action verbs", () => {
      const html = renderPermissionTesterPage(
        input({
          report: report({
            byResource: {
              Project: { actions: ["read", "update"], isSuperset: false },
              User: { actions: ["read"], isSuperset: false },
            },
          }),
        }),
      );
      expect(html).toContain("Project");
      expect(html).toContain("User");
      expect(html).toMatch(/read.*update|update.*read/);
    });

    it("flags superset (`manage`) entries with a visible badge", () => {
      const html = renderPermissionTesterPage(
        input({
          report: report({
            byResource: { Project: { actions: ["manage", "read"], isSuperset: true } },
          }),
        }),
      );
      expect(html).toMatch(/data-superset=["']true["']/);
    });

    it("shows an empty-state message when the report has zero resources", () => {
      const html = renderPermissionTesterPage(input({ report: report({ byResource: {} }) }));
      expect(html).toMatch(/no permissions/i);
    });

    it("lists resources alphabetically so toggling rules does not re-shuffle the page", () => {
      const html = renderPermissionTesterPage(
        input({
          report: report({
            byResource: {
              Webhook: { actions: ["read"], isSuperset: false },
              Project: { actions: ["read"], isSuperset: false },
              Audit: { actions: ["read"], isSuperset: false },
            },
          }),
        }),
      );
      const auditPos = html.indexOf("Audit");
      const projectPos = html.indexOf("Project");
      const webhookPos = html.indexOf("Webhook");
      expect(auditPos).toBeLessThan(projectPos);
      expect(projectPos).toBeLessThan(webhookPos);
    });
  });

  describe("XSS safety", () => {
    it("escapes user-controlled values from the form", () => {
      const html = renderPermissionTesterPage(
        input({ submitted: { userId: "<script>alert(1)</script>", tenantId: "t1" } }),
      );
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("escapes user-controlled values from the report", () => {
      const html = renderPermissionTesterPage(
        input({ report: report({ userId: "<img src=x onerror=alert(1)>" }) }),
      );
      expect(html).not.toContain("<img src=x onerror=alert(1)>");
      expect(html).toContain("&lt;img");
    });

    it("escapes resource names so a malicious subject string cannot break the page", () => {
      const html = renderPermissionTesterPage(
        input({
          report: report({
            byResource: { "<b>Inj</b>": { actions: ["read"], isSuperset: false } },
          }),
        }),
      );
      expect(html).not.toContain("<b>Inj</b>");
      expect(html).toContain("&lt;b&gt;Inj&lt;/b&gt;");
    });
  });

  describe("document chrome", () => {
    it("emits a complete HTML document", () => {
      const html = renderPermissionTesterPage(input());
      expect(html).toMatch(/^<!doctype html>/i);
      expect(html).toMatch(/<html[^>]*>/);
      expect(html).toContain("<head>");
      expect(html).toContain("<body>");
      expect(html).toMatch(/<\/html>\s*$/);
    });

    it("includes a link back to the Dev-Hub", () => {
      const html = renderPermissionTesterPage(input());
      expect(html).toMatch(/href=["']\/dev["']/);
    });
  });
});
