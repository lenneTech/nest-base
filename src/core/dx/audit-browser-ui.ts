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
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Audit Browser</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; max-width: 1200px; color: #1b1b1b; }
  h1 { margin-bottom: 1rem; }
  form.filter { display: grid; grid-template-columns: repeat(5, 1fr) auto; gap: .5rem; align-items: end; margin-bottom: 1.5rem; }
  label { display: flex; flex-direction: column; font-size: .875rem; color: #555; }
  input { padding: .5rem; border: 1px solid #ccc; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: .5rem; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
  tr[data-action="delete"] { background: #ffece8; }
  tr[data-action="create"] { background: #ecfdf3; }
  pre.diff { font-family: ui-monospace, SFMono-Regular, monospace; font-size: .8125rem; margin: 0; white-space: pre-wrap; word-break: break-word; }
  pre.diff .add { color: #0a7036; }
  pre.diff .del { color: #b3261e; }
  .empty { padding: 1rem; color: #777; }
  a.back { color: #555; text-decoration: none; font-size: .875rem; }
  a.back:hover { text-decoration: underline; }
  button { padding: .5rem 1rem; background: #1b1b1b; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
</style>
</head>
<body>
<a href="/dev" class="back">← Back to Dev Hub</a>
<h1>Audit Browser</h1>
${renderFilter(input.filter)}
${renderEntries(input.entries)}
</body>
</html>`;
}

function renderFilter(filter: AuditBrowserFilter): string {
  const value = (key: keyof AuditBrowserFilter): string => escapeHtml(filter[key] ?? "");
  return `<form class="filter" method="get">
  <label>Action <input name="action" value="${value("action")}" placeholder="create / update / delete"></label>
  <label>Resource <input name="resource" value="${value("resource")}" placeholder="Project"></label>
  <label>Actor <input name="actorUserId" value="${value("actorUserId")}" placeholder="user uuid"></label>
  <label>From <input name="from" type="date" value="${value("from")}"></label>
  <label>To <input name="to" type="date" value="${value("to")}"></label>
  <button type="submit">Filter</button>
</form>`;
}

function renderEntries(entries: AuditLogEntry[]): string {
  if (entries.length === 0) {
    return `<div class="empty">No audit entries match the current filter.</div>`;
  }
  const rows = entries.map(renderEntryRow).join("");
  return `<table data-audit-entries="true">
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
