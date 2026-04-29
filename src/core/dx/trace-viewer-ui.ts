import { renderAdminLayout } from "./admin-layout.js";
import type { TraceRecord, TraceSummary } from "./trace-buffer.js";

const INITIAL_ROW_CAP = 100;

/**
 * `/dev/traces` HTML page — recent request traces with timing +
 * status, terminal-style scroll container with sticky header, live
 * polling, and a click-to-expand "queries fired in this request"
 * drill-down.
 */
export function renderTraceViewerPage(input: {
  traces: TraceRecord[];
  summary: TraceSummary;
}): string {
  // Newest first, capped to INITIAL_ROW_CAP so an overflowing buffer
  // can't choke the DOM. The poller appends new traces to the top
  // and trims older ones the same way `/dev/logs` does.
  const newestFirst = input.traces.slice().reverse().slice(0, INITIAL_ROW_CAP);
  const rows = newestFirst.map((t) => renderRow(t)).join("\n");
  const initialCursor = input.traces.reduce((max, t) => Math.max(max, Number(t.seq ?? 0)), 0);

  const body = `
<style>
  .tv-tiles { display: grid; gap: 1rem; grid-template-columns: repeat(3, 1fr); margin-bottom: 1.5rem; }
  @media (max-width: 700px) { .tv-tiles { grid-template-columns: 1fr; } }
  .tv-tile { background: var(--surface-1); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.25rem; }
  .tv-tile--bad { border-color: var(--err); }
  .tv-tile__title { font-size: .65rem; color: var(--fg-dim); text-transform: uppercase; letter-spacing: .14em; font-weight: 600; }
  .tv-tile__value { font-size: 1.6rem; font-family: var(--font-mono); margin-top: .35rem; color: var(--fg); }

  .tv-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  .tv-toolbar__meta { color: var(--fg-dim); font-size: .78rem; font-variant-numeric: tabular-nums; }
  .tv-pulse { display: inline-block; width: 6px; height: 6px; border-radius: 999px; background: var(--accent); margin-right: .35rem; box-shadow: 0 0 6px var(--accent); animation: pulse 2s ease-in-out infinite; vertical-align: middle; }

  /* 65 dvh is the project-wide standard for dev-hub scroll containers.
     Robust regardless of how much chrome (header / tiles / toolbar)
     sits above; min-height protects very short viewports. */
  .tv-scroll {
    position: relative;
    max-height: 65dvh;
    min-height: 14rem;
    overflow-y: auto;
    background: var(--surface-1);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }
  .tv-table { width: 100%; border-collapse: collapse; font-size: .8rem; font-family: var(--font-mono); }
  .tv-table thead {
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .tv-table th {
    background: var(--surface-2); color: var(--fg-dim);
    padding: .5rem .75rem; text-align: left;
    font-weight: 600; font-size: .68rem; text-transform: uppercase; letter-spacing: .1em;
    border-bottom: 1px solid var(--line);
  }
  .tv-table td { padding: .45rem .75rem; border-top: 1px solid var(--line); color: var(--fg); }
  .tv-table tbody tr:first-child td { border-top: 0; }
  .tv-row { cursor: pointer; transition: background .12s var(--ease); }
  .tv-row:hover td { background: var(--surface-2); }
  .tv-row--expanded td { background: var(--surface-2); }
  .tv-row--new { animation: row-flash 1.6s ease-out; }
  @keyframes row-flash {
    0% { background: var(--accent-soft); }
    100% { background: transparent; }
  }

  .tv-method { display: inline-block; padding: .1rem .45rem; border-radius: 4px; font-size: .7rem; font-weight: 600; }
  .tv-method--GET { background: rgba(96,165,250,.15); color: #93c5fd; }
  .tv-method--POST { background: rgba(74,222,128,.15); color: #86efac; }
  .tv-method--PATCH, .tv-method--PUT { background: rgba(251,191,36,.15); color: #fcd34d; }
  .tv-method--DELETE { background: rgba(248,113,113,.15); color: #fca5a5; }
  .tv-status--2 { color: #86efac; }
  .tv-status--3 { color: #93c5fd; }
  .tv-status--4 { color: #fcd34d; }
  .tv-status--5 { color: #fca5a5; }
  .tv-duration--slow { color: #fcd34d; }
  .tv-duration--vslow { color: #fca5a5; font-weight: 600; }

  /* Drill-down panel for "queries fired in this request". */
  .tv-drill-row td { background: var(--surface-2); padding: .65rem 1rem; border-top: 0; }
  .tv-drill { font-family: var(--font-mono); font-size: .75rem; }
  .tv-drill__title { color: var(--fg-dim); font-size: .65rem; text-transform: uppercase; letter-spacing: .12em; margin: 0 0 .5rem; font-weight: 600; }
  .tv-drill__row { display: grid; grid-template-columns: 5rem 1fr; gap: .75rem; padding: .25rem 0; border-top: 1px solid var(--line); color: var(--fg); }
  .tv-drill__row:first-of-type { border-top: 0; }
  .tv-drill__dur { color: var(--fg-muted); font-variant-numeric: tabular-nums; }
  .tv-drill__dur--slow { color: #fcd34d; }
  .tv-drill__dur--bad { color: #fca5a5; font-weight: 600; }
  .tv-drill__sql { white-space: pre-wrap; word-break: break-all; }
  .tv-drill__empty { color: var(--fg-dim); font-style: italic; padding: .25rem 0; }
</style>

<div class="tv-tiles">
  <div class="tv-tile"><div class="tv-tile__title">Total requests</div><div class="tv-tile__value">${input.summary.total}</div></div>
  <div class="tv-tile ${input.summary.errors > 0 ? "tv-tile--bad" : ""}"><div class="tv-tile__title">Server errors (5xx)</div><div class="tv-tile__value">${input.summary.errors}</div></div>
  <div class="tv-tile"><div class="tv-tile__title">Slowest</div><div class="tv-tile__value">${input.summary.slowestMs} ms</div></div>
</div>

<div class="tv-toolbar">
  <div>
    <span class="tv-pulse"></span><strong>Live tail</strong>
    <span class="tv-toolbar__meta">— polled every 2 s, click a row for query drill-down</span>
  </div>
  <div class="tv-toolbar__meta" id="tv-meta-status">auto-refresh</div>
</div>

<div class="tv-scroll" data-tv-scroll>
  <table class="tv-table">
    <thead>
      <tr><th style="width:7rem">Time</th><th style="width:5rem">Method</th><th>Path</th><th style="width:5rem">Status</th><th style="width:6rem">Duration</th><th style="width:8rem">Request-Id</th></tr>
    </thead>
    <tbody data-tv-tbody>
${rows.length > 0 ? rows : '<tr><td colspan="6" style="color:var(--fg-dim);text-align:center;padding:1.5rem">No traces yet — make a request to populate.</td></tr>'}
    </tbody>
  </table>
</div>

<script>
(function() {
  const tbody = document.querySelector('[data-tv-tbody]');
  const status = document.getElementById('tv-meta-status');
  if (!tbody) return;

  let cursor = ${initialCursor};
  const MAX_ROWS = ${INITIAL_ROW_CAP};

  // ── Live polling: append newest traces to the top.
  setInterval(tick, 2000);
  async function tick() {
    try {
      const r = await fetch('/dev/traces.json?since=' + cursor, { cache: 'no-store' });
      if (!r.ok) return;
      const json = await r.json();
      const traces = (json.traces || []).filter((t) => Number(t.seq || 0) > cursor);
      if (traces.length === 0) return;
      // Newest first → prepend in seq-descending order.
      traces.sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0));
      for (const t of traces) {
        cursor = Math.max(cursor, Number(t.seq || 0));
        tbody.insertAdjacentHTML('afterbegin', rowHtml(t));
      }
      // Cap DOM size — drop excess rows from the bottom.
      while (tbody.querySelectorAll('tr.tv-row').length > MAX_ROWS) {
        const last = tbody.querySelector('tr.tv-row:last-of-type');
        if (!last) break;
        // Also drop any drilldown sibling that follows.
        const next = last.nextElementSibling;
        last.remove();
        if (next && next.classList.contains('tv-drill-row')) next.remove();
      }
    } catch {
      if (status) status.textContent = '✕ refresh failed';
    }
  }

  // ── Pro-Request drill-down: click a row to expand inline with the
  // queries that ran during that request (filtered by requestId).
  tbody.addEventListener('click', async (event) => {
    const row = event.target.closest('tr.tv-row');
    if (!row) return;
    const reqId = row.getAttribute('data-trace-row');
    if (!reqId) return;
    // Toggle: if a drill row already follows, remove it.
    const next = row.nextElementSibling;
    if (next && next.classList.contains('tv-drill-row')) {
      row.classList.remove('tv-row--expanded');
      next.remove();
      return;
    }
    row.classList.add('tv-row--expanded');
    const drillRow = document.createElement('tr');
    drillRow.className = 'tv-drill-row';
    drillRow.innerHTML =
      '<td colspan="6"><div class="tv-drill"><div class="tv-drill__title">Loading queries…</div></div></td>';
    row.after(drillRow);
    try {
      const r = await fetch('/dev/queries.json?requestId=' + encodeURIComponent(reqId), {
        cache: 'no-store',
      });
      if (!r.ok) throw new Error('fetch failed');
      const json = await r.json();
      const queries = json.recent || [];
      drillRow.querySelector('td').innerHTML = renderDrill(queries);
    } catch {
      drillRow.querySelector('td').innerHTML =
        '<div class="tv-drill__empty">Failed to load queries.</div>';
    }
  });

  function rowHtml(t) {
    const ts = new Date(t.startedAtMs).toISOString().slice(11, 23);
    const statusClass = 'tv-status--' + Math.floor(Number(t.status) / 100);
    const methodClass = 'tv-method--' + String(t.method);
    const durClass =
      t.durationMs > 1000 ? 'tv-duration--vslow' :
      t.durationMs > 250 ? 'tv-duration--slow' : '';
    return '<tr class="tv-row tv-row--new" data-trace-row="' + esc(t.requestId) + '">' +
      '<td>' + esc(ts) + '</td>' +
      '<td><span class="tv-method ' + methodClass + '">' + esc(String(t.method)) + '</span></td>' +
      '<td>' + esc(String(t.path)) + '</td>' +
      '<td class="' + statusClass + '">' + Number(t.status) + '</td>' +
      '<td class="' + durClass + '">' + Number(t.durationMs) + ' ms</td>' +
      '<td style="color:var(--fg-muted)">' + esc(String(t.requestId).slice(0, 8)) + '…</td>' +
      '</tr>';
  }
  function renderDrill(queries) {
    if (!queries.length) {
      return '<div class="tv-drill"><div class="tv-drill__title">Queries fired during this request</div><div class="tv-drill__empty">No queries recorded for this request.</div></div>';
    }
    const rows = queries.map((q) => {
      const dc = q.durationMs > 200 ? 'tv-drill__dur--bad' :
                 q.durationMs > 50 ? 'tv-drill__dur--slow' : '';
      return '<div class="tv-drill__row">' +
        '<div class="tv-drill__dur ' + dc + '">' + Number(q.durationMs) + ' ms</div>' +
        '<div class="tv-drill__sql">' + esc(String(q.sql)) + '</div>' +
        '</div>';
    }).join('');
    return '<div class="tv-drill"><div class="tv-drill__title">Queries fired during this request (' + queries.length + ')</div>' + rows + '</div>';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
})();
</script>
`;

  return renderAdminLayout({
    title: "Traces",
    subtitle:
      "Recent HTTP request traces (in-memory ring buffer; cleared on dev-server restart). Click a row to see which DB queries ran during that request.",
    currentNav: "traces",
    body,
  });
}

function renderRow(t: TraceRecord): string {
  const ts = new Date(t.startedAtMs).toISOString().slice(11, 23);
  const statusClass = `tv-status--${Math.floor(t.status / 100)}`;
  const methodClass = `tv-method--${t.method}`;
  const durClass =
    t.durationMs > 1000 ? "tv-duration--vslow" : t.durationMs > 250 ? "tv-duration--slow" : "";
  return `<tr class="tv-row" data-trace-row="${escapeHtml(t.requestId)}">
    <td>${escapeHtml(ts)}</td>
    <td><span class="tv-method ${methodClass}">${escapeHtml(t.method)}</span></td>
    <td>${escapeHtml(t.path)}</td>
    <td class="${statusClass}">${t.status}</td>
    <td class="${durClass}">${Math.round(t.durationMs)} ms</td>
    <td style="color:var(--fg-muted)">${escapeHtml(t.requestId.slice(0, 8))}…</td>
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
