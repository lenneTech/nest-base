import type { PermissionReport, ResourceReport } from "../permissions/permission-report.js";
import { renderAdminLayout } from "./admin-layout.js";

/**
 * Permission-Tester UI renderer (PLAN.md §27.1 + §32 Phase 8).
 *
 * Pure function: takes the request input and (when a lookup ran)
 * the resulting PermissionReport, produces the HTML string the
 * `/admin/permissions/test` controller returns. Keeping the
 * renderer pure means we can verify the page shape and the
 * XSS-safe escaping without booting NestJS.
 *
 * Every user-controlled fragment (form values, report payload,
 * resource names) is HTML-escaped through the standard
 * five-character substitution table.
 */

export interface PermissionTesterPageInput {
  /** What the admin submitted in the form (echoed back). */
  submitted?: { userId?: string; tenantId?: string };
  /** Result of the permission lookup, if any. */
  report?: PermissionReport;
}

export function renderPermissionTesterPage(input: PermissionTesterPageInput): string {
  const submittedUser = escapeHtml(input.submitted?.userId ?? "");
  const submittedTenant = escapeHtml(input.submitted?.tenantId ?? "");
  const body = `
<div class="admin-card">
  <h2 class="admin-card__title">Lookup</h2>
  <form method="get" class="admin-form">
    <div class="row">
      <label>User ID
        <input name="userId" value="${submittedUser}" placeholder="user uuid">
      </label>
      <label>Tenant ID
        <input name="tenantId" value="${submittedTenant}" placeholder="tenant uuid">
      </label>
      <button type="submit">Test</button>
    </div>
  </form>
</div>
${renderReport(input.report)}
`;
  return renderAdminLayout({
    title: "Permission Tester",
    subtitle: "Resolve effective CASL ability for a user/tenant pair.",
    currentNav: "permissions",
    body,
  });
}

function renderReport(report: PermissionReport | undefined): string {
  if (!report) return "";
  const userId = escapeHtml(report.userId);
  const tenantId = escapeHtml(report.tenantId);
  const resources = Object.keys(report.byResource).sort();
  if (resources.length === 0) {
    return (
      `<div class="admin-card">` +
      `<p class="admin-meta">User <strong>${userId}</strong> in tenant <strong>${tenantId}</strong></p>` +
      `<div class="admin-empty">No permissions found for this user.</div>` +
      `</div>`
    );
  }
  const rows = resources
    .map((resource) => renderRow(resource, report.byResource[resource]!))
    .join("");
  return (
    `<div class="admin-card">` +
    `<p class="admin-meta">User <strong>${userId}</strong> in tenant <strong>${tenantId}</strong></p>` +
    `<table class="admin-table" data-permission-report="true">` +
    `<thead><tr><th>Resource</th><th>Actions</th></tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>` +
    `</div>`
  );
}

function renderRow(resource: string, entry: ResourceReport): string {
  const safeResource = escapeHtml(resource);
  const safeActions = entry.actions.map(escapeHtml).join(", ");
  const supersetAttr = entry.isSuperset ? ' data-superset="true"' : "";
  return `<tr${supersetAttr}><td>${safeResource}</td><td>${safeActions}</td></tr>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
