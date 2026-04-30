/**
 * Realtime-Inspector UI renderer.
 *
 * Pure HTML for the `/admin/realtime` page. Two read models feed in:
 *
 *   - active sockets snapshot (SocketGateway subscriber registry)
 *   - recent events (RealtimeService local dispatches, last N)
 *
 * The renderer is read-only today; per-row `data-socket-id` hooks
 * leave the door open for a future disconnect action without
 * shipping that surface in this slice.
 *
 * Auto-refresh is opt-in via `refreshSeconds` so a controller can
 * decide between "live page that re-fetches every 5s" and "static
 * snapshot the admin reloads manually". When unset, no meta-refresh.
 */

import { renderAdminLayout } from "./admin-layout.js";
import type {
  ActiveSocketEntry,
  RealtimeEventEntry,
  RealtimeInspectorPageInput,
} from "./realtime-inspector-types.js";

export type { ActiveSocketEntry, RealtimeEventEntry, RealtimeInspectorPageInput };

export function renderRealtimeInspectorPage(input: RealtimeInspectorPageInput): string {
  const body = `
${input.refreshSeconds ? `<meta http-equiv="refresh" content="${input.refreshSeconds}">` : ""}
<div class="admin-card">
  <h2 class="admin-card__title">Active Sockets <span class="admin-meta">(${input.sockets.length} active)</span></h2>
  ${renderSockets(input.sockets)}
</div>
<div class="admin-card">
  <h2 class="admin-card__title">Recent Events</h2>
  ${renderEvents(input.events)}
</div>`;
  return renderAdminLayout({
    title: "Realtime Inspector",
    subtitle: "Active Socket.IO connections and recent broadcast events.",
    currentNav: "realtime",
    body,
  });
}

function renderSockets(sockets: ActiveSocketEntry[]): string {
  if (sockets.length === 0) {
    return `<div class="admin-empty">No active sockets right now.</div>`;
  }
  const rows = sockets.map(renderSocketRow).join("");
  return `<table class="admin-table" data-sockets="true">
<thead><tr><th>Socket</th><th>User</th><th>Tenant</th><th>Channels</th><th>Connected at</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function renderSocketRow(s: ActiveSocketEntry): string {
  const id = escapeHtml(s.id);
  const channels =
    s.channels.length === 0
      ? "<em>none</em>"
      : `<ul class="channels">${s.channels.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`;
  return `<tr data-socket-id="${id}">
<td>${id}</td>
<td>${escapeHtml(s.userId)}</td>
<td>${escapeHtml(s.tenantId)}</td>
<td>${channels}</td>
<td>${escapeHtml(s.connectedAt)}</td>
</tr>`;
}

function renderEvents(events: RealtimeEventEntry[]): string {
  if (events.length === 0) {
    return `<div class="admin-empty">No recent events captured.</div>`;
  }
  const rows = events.map(renderEventRow).join("");
  return `<table class="admin-table" data-events="true">
<thead><tr><th>When</th><th>Channel</th><th>Type</th><th>Preview</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function renderEventRow(e: RealtimeEventEntry): string {
  return `<tr>
<td>${escapeHtml(e.occurredAt)}</td>
<td>${escapeHtml(e.channel)}</td>
<td>${escapeHtml(e.eventType)}</td>
<td><pre class="payload">${escapeHtml(e.payloadPreview)}</pre></td>
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
