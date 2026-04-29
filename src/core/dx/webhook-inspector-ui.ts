/**
 * Webhook-Inspector UI renderer (PLAN.md §27.1 + §32 Phase 8).
 *
 * Pure HTML for the `/admin/webhooks` page. The controller fetches
 * recent deliveries through the dispatcher's delivery store, applies
 * the optional status filter, and hands the list to this renderer.
 *
 * The renderer keeps its own read model — `DeliveryListEntry` — so
 * the dispatcher's `DeliveryRecord` (persistence-shaped) and the
 * inspector's view (human-shaped) can evolve independently.
 *
 * Every user-controlled string is HTML-escaped through the standard
 * five-character substitution table.
 */

export type DeliveryStatus = "DELIVERED" | "FAILED";

export interface DeliveryListEntry {
  id: string;
  endpointId: string;
  eventType?: string;
  status: DeliveryStatus;
  statusCode?: number;
  attemptCount: number;
  occurredAt?: string;
  errorMessage?: string;
}

export interface WebhookInspectorPageInput {
  deliveries: DeliveryListEntry[];
  filter?: { status?: DeliveryStatus | "ALL" };
  csrfToken?: string;
}

export function renderWebhookInspectorPage(input: WebhookInspectorPageInput): string {
  const filterStatus = input.filter?.status ?? "ALL";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Webhook Inspector</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; max-width: 1100px; color: #1b1b1b; }
  h1 { margin-bottom: 1.5rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: .5rem; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
  tr[data-status="FAILED"] { background: #ffece8; }
  .empty { padding: 1rem; color: #777; }
  a.back { color: #555; text-decoration: none; font-size: .875rem; }
  a.back:hover { text-decoration: underline; }
  form.filter { margin-bottom: 1rem; }
  form.redeliver { display: inline; }
  button { padding: .25rem .75rem; background: #1b1b1b; color: #fff; border: 0; border-radius: 4px; cursor: pointer; font-size: .875rem; }
</style>
</head>
<body>
<a href="/dev" class="back">← Back to Dev Hub</a>
<h1>Webhook Inspector</h1>
${renderFilter(filterStatus)}
${renderTable(input)}
</body>
</html>`;
}

function renderFilter(currentStatus: DeliveryStatus | "ALL"): string {
  const opt = (value: string, label: string): string =>
    `<option value="${value}"${value === currentStatus ? " selected" : ""}>${label}</option>`;
  return `<form class="filter" method="get">
  <label>Status
    <select name="status">
      ${opt("ALL", "All")}
      ${opt("DELIVERED", "Delivered")}
      ${opt("FAILED", "Failed")}
    </select>
  </label>
  <button type="submit">Apply</button>
</form>`;
}

function renderTable(input: WebhookInspectorPageInput): string {
  if (input.deliveries.length === 0) {
    return `<div class="empty">No deliveries to show.</div>`;
  }
  const rows = input.deliveries.map((d) => renderRow(d, input.csrfToken)).join("");
  return `<table data-deliveries="true">
<thead><tr><th>When</th><th>Event</th><th>Endpoint</th><th>Status</th><th>HTTP</th><th>Attempts</th><th>Error</th><th></th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function renderRow(delivery: DeliveryListEntry, csrfToken: string | undefined): string {
  const safeEvent = escapeHtml(delivery.eventType ?? "");
  const safeEndpoint = escapeHtml(delivery.endpointId);
  const safeStatus = escapeHtml(delivery.status);
  const safeOccurred = escapeHtml(delivery.occurredAt ?? "");
  const safeError = delivery.errorMessage ? escapeHtml(delivery.errorMessage) : "";
  const httpCode = delivery.statusCode === undefined ? "" : escapeHtml(String(delivery.statusCode));
  const attempts = escapeHtml(String(delivery.attemptCount));
  const safeId = escapeHtml(delivery.id);
  const csrfField = csrfToken
    ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">`
    : "";
  return `<tr data-status="${safeStatus}">
<td>${safeOccurred}</td>
<td>${safeEvent}</td>
<td>${safeEndpoint}</td>
<td>${safeStatus}</td>
<td>${httpCode}</td>
<td>${attempts}</td>
<td>${safeError}</td>
<td>
  <form class="redeliver" method="post" action="/admin/webhooks/${safeId}/redeliver">
    ${csrfField}
    <button type="submit">Re-deliver</button>
  </form>
</td>
</tr>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
