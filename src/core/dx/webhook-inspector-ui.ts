/**
 * Webhook-Inspector UI renderer.
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

import { renderAdminLayout } from "./admin-layout.js";
import type {
  DeliveryListEntry,
  DeliveryStatus,
  WebhookInspectorPageInput,
} from "./webhook-inspector-types.js";

export type { DeliveryListEntry, DeliveryStatus, WebhookInspectorPageInput };

export function renderWebhookInspectorPage(input: WebhookInspectorPageInput): string {
  const filterStatus = input.filter?.status ?? "ALL";
  const body = `
<div class="admin-card">
  <h2 class="admin-card__title">Filter</h2>
  ${renderFilter(filterStatus)}
</div>
<div class="admin-card">
  <h2 class="admin-card__title">Recent deliveries</h2>
  ${renderTable(input)}
</div>`;
  return renderAdminLayout({
    title: "Webhook Inspector",
    subtitle: "Recent deliveries, retry counts, and re-delivery actions.",
    currentNav: "webhooks",
    body,
  });
}

function renderFilter(currentStatus: DeliveryStatus | "ALL"): string {
  const opt = (value: string, label: string): string =>
    `<option value="${value}"${value === currentStatus ? " selected" : ""}>${label}</option>`;
  return `<form class="admin-form filter" method="get">
  <div class="row">
    <label>Status
      <select name="status">
        ${opt("ALL", "All")}
        ${opt("DELIVERED", "Delivered")}
        ${opt("FAILED", "Failed")}
      </select>
    </label>
    <span></span>
    <button type="submit">Apply</button>
  </div>
</form>`;
}

function renderTable(input: WebhookInspectorPageInput): string {
  if (input.deliveries.length === 0) {
    return `<div class="admin-empty">No deliveries to show.</div>`;
  }
  const rows = input.deliveries.map((d) => renderRow(d, input.csrfToken)).join("");
  return `<table class="admin-table" data-deliveries="true">
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
