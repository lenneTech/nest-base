/**
 * Realtime-Inspector UI renderer (PLAN.md §27.1 + §32 Phase 8).
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

export interface ActiveSocketEntry {
  id: string;
  userId: string;
  tenantId: string;
  channels: string[];
  connectedAt: string;
}

export interface RealtimeEventEntry {
  channel: string;
  eventType: string;
  payloadPreview: string;
  occurredAt: string;
}

export interface RealtimeInspectorPageInput {
  sockets: ActiveSocketEntry[];
  events: RealtimeEventEntry[];
  refreshSeconds?: number;
}

export function renderRealtimeInspectorPage(input: RealtimeInspectorPageInput): string {
  const meta = input.refreshSeconds
    ? `<meta http-equiv="refresh" content="${input.refreshSeconds}">`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${meta}
<title>Realtime Inspector</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; max-width: 1100px; color: #1b1b1b; }
  h1 { margin-bottom: 1rem; }
  h2 { margin-top: 2rem; font-size: 1.125rem; color: #333; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: .5rem; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
  ul.channels { margin: 0; padding-left: 1.25rem; }
  .empty { padding: 1rem; color: #777; }
  .meta { color: #555; font-size: .875rem; margin-bottom: 1rem; }
  a.back { color: #555; text-decoration: none; font-size: .875rem; }
  a.back:hover { text-decoration: underline; }
  pre.payload { font-family: ui-monospace, SFMono-Regular, monospace; font-size: .8125rem; margin: 0; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<a href="/dev" class="back">← Back to Dev Hub</a>
<h1>Realtime Inspector</h1>
${renderSockets(input.sockets)}
${renderEvents(input.events)}
</body>
</html>`;
}

function renderSockets(sockets: ActiveSocketEntry[]): string {
  const heading = `<h2>Active Sockets <span class="meta">(${sockets.length} active)</span></h2>`;
  if (sockets.length === 0) {
    return `${heading}<div class="empty">No active sockets right now.</div>`;
  }
  const rows = sockets.map(renderSocketRow).join("");
  return `${heading}<table data-sockets="true">
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
  const heading = `<h2>Recent Events</h2>`;
  if (events.length === 0) {
    return `${heading}<div class="empty">No recent events captured.</div>`;
  }
  const rows = events.map(renderEventRow).join("");
  return `${heading}<table data-events="true">
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
