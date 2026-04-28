import type { PermissionReport, ResourceReport } from '../permissions/permission-report.js';

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
  const submittedUser = escapeHtml(input.submitted?.userId ?? '');
  const submittedTenant = escapeHtml(input.submitted?.tenantId ?? '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Permission Tester</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; max-width: 920px; color: #1b1b1b; }
  h1 { margin-bottom: 1.5rem; }
  form { display: grid; grid-template-columns: 1fr 1fr auto; gap: .5rem; align-items: end; margin-bottom: 2rem; }
  label { display: flex; flex-direction: column; font-size: .875rem; color: #555; }
  input { padding: .5rem; border: 1px solid #ccc; border-radius: 4px; }
  button { padding: .5rem 1rem; background: #1b1b1b; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: .5rem; border-bottom: 1px solid #eee; text-align: left; }
  tr[data-superset="true"] { background: #fff7d6; }
  .empty { padding: 1rem; color: #777; }
  .meta { color: #555; margin-bottom: 1rem; }
  a.back { color: #555; text-decoration: none; font-size: .875rem; }
  a.back:hover { text-decoration: underline; }
</style>
</head>
<body>
<a href="/dev" class="back">← Back to Dev Hub</a>
<h1>Permission Tester</h1>
<form method="get">
  <label>User ID
    <input name="userId" value="${submittedUser}" placeholder="user uuid">
  </label>
  <label>Tenant ID
    <input name="tenantId" value="${submittedTenant}" placeholder="tenant uuid">
  </label>
  <button type="submit">Test</button>
</form>
${renderReport(input.report)}
</body>
</html>`;
}

function renderReport(report: PermissionReport | undefined): string {
  if (!report) return '';
  const userId = escapeHtml(report.userId);
  const tenantId = escapeHtml(report.tenantId);
  const resources = Object.keys(report.byResource).sort();
  if (resources.length === 0) {
    return `<p class="meta">User <strong>${userId}</strong> in tenant <strong>${tenantId}</strong></p>` +
      `<div class="empty">No permissions found for this user.</div>`;
  }
  const rows = resources
    .map((resource) => renderRow(resource, report.byResource[resource]!))
    .join('');
  return `<p class="meta">User <strong>${userId}</strong> in tenant <strong>${tenantId}</strong></p>` +
    `<table data-permission-report="true">` +
    `<thead><tr><th>Resource</th><th>Actions</th></tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>`;
}

function renderRow(resource: string, entry: ResourceReport): string {
  const safeResource = escapeHtml(resource);
  const safeActions = entry.actions.map(escapeHtml).join(', ');
  const supersetAttr = entry.isSuperset ? ' data-superset="true"' : '';
  return `<tr${supersetAttr}><td>${safeResource}</td><td>${safeActions}</td></tr>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
