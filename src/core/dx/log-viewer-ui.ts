import type { LogRecord } from "../observability/logger.js";
import { renderAdminLayout } from "./admin-layout.js";

/**
 * Log-Viewer UI renderer.
 *
 * Pure HTML for `/dev/logs`. Renders the in-memory ring-buffer's tail
 * with level-coloured rows, context labels, and a JSON-payload
 * preview. The page polls `/dev/logs/stream` every 2 s for new
 * records (see embedded script). Keeping the renderer pure means we
 * can verify the row layout, escape behaviour, and level mapping in
 * tests without wiring up the full HTTP layer.
 */
export interface LogViewerInput {
  records: readonly LogRecord[];
  bufferCapacity: number;
  bufferSize: number;
}

export function renderLogViewerPage(input: LogViewerInput): string {
  const body = `
<style>
  .log-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  .log-toolbar__meta { color: var(--fg-dim); font-size: .78rem; font-variant-numeric: tabular-nums; }
  .log-toolbar strong { color: var(--fg); font-weight: 600; }
  .log-table {
    width: 100%; border-collapse: collapse;
    background: var(--surface-1); border: 1px solid var(--line);
    border-radius: var(--radius-sm); overflow: hidden;
    font-family: var(--font-mono); font-size: .78rem;
  }
  .log-table th {
    background: var(--surface-2); color: var(--fg-dim);
    padding: .65rem .9rem; text-align: left;
    font-size: .65rem; text-transform: uppercase; letter-spacing: .1em; font-weight: 600;
    border-bottom: 1px solid var(--line);
  }
  .log-table td {
    padding: .55rem .9rem; border-top: 1px solid var(--line);
    vertical-align: top; line-height: 1.55;
  }
  .log-table tr:first-child td { border-top: 0; }
  .log-table tr:hover td { background: var(--surface-2); }
  .log-row--trace td { color: var(--fg-faint); }
  .log-row--debug td { color: var(--fg-dim); }
  .log-row--info td { color: var(--fg-muted); }
  .log-row--warn td { background: rgba(251, 191, 36, .04); }
  .log-row--error td { background: rgba(248, 113, 113, .05); color: var(--fg); }
  .log-row--fatal td { background: rgba(248, 113, 113, .1); color: var(--err); font-weight: 500; }
  .log-level {
    display: inline-block; padding: .12rem .55rem;
    border-radius: 4px; font-weight: 600; font-size: .62rem;
    text-transform: uppercase; letter-spacing: .1em;
    border: 1px solid transparent;
  }
  .log-level--trace, .log-level--debug { background: var(--surface-3); color: var(--fg-dim); }
  .log-level--info { background: var(--surface-3); color: var(--fg-muted); border-color: var(--line); }
  .log-level--warn { background: rgba(251, 191, 36, .12); color: var(--warn); border-color: rgba(251, 191, 36, .3); }
  .log-level--error, .log-level--fatal { background: rgba(248, 113, 113, .12); color: var(--err); border-color: rgba(248, 113, 113, .3); }
  .log-context { color: var(--accent); font-size: .73rem; opacity: .8; }
  .log-empty { padding: 2.5rem; text-align: center; color: var(--fg-muted); }
  .log-pulse { display: inline-block; width: 6px; height: 6px; border-radius: 999px; background: var(--accent); margin-right: .35rem; box-shadow: 0 0 6px var(--accent); animation: pulse 2s ease-in-out infinite; vertical-align: middle; }
</style>

<div class="admin-card">
  <div class="log-toolbar">
    <div>
      <span class="log-pulse"></span><strong>Live tail</strong>
      <span class="log-toolbar__meta">— polled every 2 s, ring-buffer ${input.bufferSize}/${input.bufferCapacity}</span>
    </div>
    <div class="log-toolbar__meta" id="log-meta-status">auto-refresh</div>
  </div>
  ${renderTable(input.records)}
</div>

<script>
(function() {
  const tbody = document.querySelector('[data-log-tbody]');
  const status = document.getElementById('log-meta-status');
  if (!tbody) return;
  let cursor = ${input.records.length > 0 ? Number(input.records[input.records.length - 1]?.seq ?? 0) : 0};
  let timer = setInterval(tick, 2000);
  async function tick() {
    try {
      const r = await fetch('/dev/logs.json?since=' + cursor, { cache: 'no-store' });
      if (!r.ok) return;
      const records = await r.json();
      if (records.length === 0) return;
      for (const rec of records) {
        cursor = Math.max(cursor, Number(rec.seq) || 0);
        tbody.insertAdjacentHTML('beforeend', rowHtml(rec));
      }
      // keep last 500 rows in DOM
      while (tbody.children.length > 500) tbody.removeChild(tbody.firstElementChild);
      tbody.parentElement?.parentElement?.scrollTo({ top: 9e9, behavior: 'smooth' });
    } catch {
      if (status) status.textContent = '✕ refresh failed';
    }
  }
  function rowHtml(rec) {
    const level = ({10:'trace',20:'debug',30:'info',40:'warn',50:'error',60:'fatal'})[rec.level] || 'info';
    const time = new Date(rec.time).toISOString().slice(11, 23);
    const ctx = rec.context ? '[' + esc(rec.context) + ']' : '';
    return '<tr class="log-row--' + level + '">' +
      '<td>' + time + '</td>' +
      '<td><span class="log-level log-level--' + level + '">' + level + '</span></td>' +
      '<td><span class="log-context">' + ctx + '</span> ' + esc(String(rec.msg ?? '')) + '</td>' +
      '</tr>';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
})();
</script>
`;
  return renderAdminLayout({
    title: "Logs",
    subtitle: `In-memory ring buffer (${input.bufferCapacity} entries) of every Pino record this server emits.`,
    currentNav: "logs",
    body,
  });
}

function renderTable(records: readonly LogRecord[]): string {
  if (records.length === 0) {
    return `<table class="log-table"><thead><tr><th style="width:6rem">Time</th><th style="width:5rem">Level</th><th>Message</th></tr></thead><tbody data-log-tbody></tbody></table>
    <div class="log-empty">No records yet — interact with the API and they'll appear here.</div>`;
  }
  const rows = records.map(renderRow).join("\n");
  return `<table class="log-table" data-log-tail="true">
    <thead><tr><th style="width:6rem">Time</th><th style="width:5rem">Level</th><th>Message</th></tr></thead>
    <tbody data-log-tbody>${rows}</tbody>
  </table>`;
}

function renderRow(record: LogRecord): string {
  const level = levelName(record.level);
  const time = new Date(record.time).toISOString().slice(11, 23);
  const ctx = record.context ? `[${escapeHtml(String(record.context))}]` : "";
  const msg = escapeHtml(String(record.msg ?? ""));
  return `<tr class="log-row--${level}">
    <td>${escapeHtml(time)}</td>
    <td><span class="log-level log-level--${level}">${escapeHtml(level)}</span></td>
    <td><span class="log-context">${ctx}</span> ${msg}</td>
  </tr>`;
}

function levelName(level: number): string {
  if (level >= 60) return "fatal";
  if (level >= 50) return "error";
  if (level >= 40) return "warn";
  if (level >= 30) return "info";
  if (level >= 20) return "debug";
  return "trace";
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
