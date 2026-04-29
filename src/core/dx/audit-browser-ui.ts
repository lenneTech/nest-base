/**
 * Audit-Browser UI renderer (PLAN.md §27.1 + §32 Phase 8).
 *
 * Pure HTML for the `/admin/audit` page. The controller filters and
 * paginates audit-log entries server-side and hands the result plus
 * the active filter state to this renderer.
 *
 * The renderer keeps its own `AuditLogEntry` read model so the
 * audit-log persistence module can evolve independently. Diffs are
 * rendered as line-prefixed JSON snippets — no JS-side diff library
 * — and delete entries get a `data-action="delete"` hook that the
 * CSS uses for a red row highlight (same pattern the Webhook-
 * Inspector uses for failed deliveries).
 */

import { renderAdminLayout } from "./admin-layout.js";

export type AuditAction = "create" | "update" | "delete" | string;

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  actorUserId?: string;
  tenantId?: string;
  occurredAt: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface AuditBrowserFilter {
  action?: string;
  resource?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
}

export interface AuditBrowserPageInput {
  entries: AuditLogEntry[];
  filter: AuditBrowserFilter;
}

export function renderAuditBrowserPage(input: AuditBrowserPageInput): string {
  const body = `
<style>
  pre.diff { margin: 0; white-space: pre-wrap; word-break: break-word; }
  pre.diff .add { color: var(--success); }
  pre.diff .del { color: var(--danger); }
  tr[data-action="delete"] td { background: rgba(248, 81, 73, .08); }
  tr[data-action="create"] td { background: rgba(63, 185, 80, .08); }
</style>
<div class="admin-card">
  <h2 class="admin-card__title">Filter</h2>
  ${renderFilter(input.filter)}
</div>
<div class="admin-card">
  <h2 class="admin-card__title">Entries</h2>
  ${renderEntries(input.entries)}
</div>`;
  return renderAdminLayout({
    title: "Audit Browser",
    subtitle: "Filter and inspect tenant-scoped audit-log entries with diffs.",
    currentNav: "audit",
    body,
  });
}

function renderFilter(filter: AuditBrowserFilter): string {
  const value = (key: keyof AuditBrowserFilter): string => escapeHtml(filter[key] ?? "");
  return `<form class="admin-form filter" method="get" style="grid-template-columns: repeat(5, 1fr) auto;">
  <div class="row" style="grid-template-columns: repeat(5, 1fr) auto;">
    <label>Action <input name="action" value="${value("action")}" placeholder="create / update / delete"></label>
    <label>Resource <input name="resource" value="${value("resource")}" placeholder="Project"></label>
    <label>Actor <input name="actorUserId" value="${value("actorUserId")}" placeholder="user uuid"></label>
    <label>From <input name="from" type="date" value="${value("from")}"></label>
    <label>To <input name="to" type="date" value="${value("to")}"></label>
    <button type="submit">Filter</button>
  </div>
</form>`;
}

function renderEntries(entries: AuditLogEntry[]): string {
  if (entries.length === 0) {
    return `<div class="admin-empty">No audit entries match the current filter.</div>`;
  }
  const rows = entries.map(renderEntryRow).join("");
  return `<table class="admin-table" data-audit-entries="true">
<thead><tr><th>When</th><th>Action</th><th>Resource</th><th>ID</th><th>Actor</th><th>Diff</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function renderEntryRow(entry: AuditLogEntry): string {
  const safeAction = escapeHtml(entry.action);
  return `<tr data-action="${safeAction}">
<td>${escapeHtml(entry.occurredAt)}</td>
<td>${safeAction}</td>
<td>${escapeHtml(entry.resource)}</td>
<td>${escapeHtml(entry.resourceId ?? "")}</td>
<td>${escapeHtml(entry.actorUserId ?? "")}</td>
<td>${renderDiff(entry.before, entry.after)}</td>
</tr>`;
}

function renderDiff(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): string {
  if (!before && !after) return "";
  const beforeLines = before
    ? formatJson(before)
        .split("\n")
        .map((l) => `<span class="del">- ${escapeHtml(l)}</span>`)
    : [];
  const afterLines = after
    ? formatJson(after)
        .split("\n")
        .map((l) => `<span class="add">+ ${escapeHtml(l)}</span>`)
    : [];
  return `<pre class="diff">${[...beforeLines, ...afterLines].join("\n")}</pre>`;
}

function formatJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
