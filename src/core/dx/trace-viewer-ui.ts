import { renderAdminLayout } from "./admin-layout.js";
import type { TraceRecord, TraceSummary } from "./trace-buffer.js";

/** `/dev/traces` HTML page — recent request traces with timing + status. */
export function renderTraceViewerPage(input: {
  traces: TraceRecord[];
  summary: TraceSummary;
}): string {
  const rows = input.traces
    .slice()
    .reverse()
    .map((t) => renderRow(t))
    .join("\n");

  const body = `
<style>
  .tv-tiles { display: grid; gap: 1rem; grid-template-columns: repeat(3, 1fr); margin-bottom: 1.5rem; }
  @media (max-width: 700px) { .tv-tiles { grid-template-columns: 1fr; } }
  .tv-tile { background: var(--surface-1); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.25rem; }
  .tv-tile--bad { border-color: var(--err); }
  .tv-tile__title { font-size: .65rem; color: var(--fg-dim); text-transform: uppercase; letter-spacing: .14em; font-weight: 600; }
  .tv-tile__value { font-size: 1.6rem; font-family: var(--font-mono); margin-top: .35rem; color: var(--fg); }

  .tv-table { width: 100%; border-collapse: collapse; font-size: .8rem; }
  .tv-table th, .tv-table td { text-align: left; padding: .45rem .75rem; border-bottom: 1px solid var(--line); }
  .tv-table th { color: var(--fg-dim); font-weight: 600; font-size: .7rem; text-transform: uppercase; letter-spacing: .1em; }
  .tv-table td { font-family: var(--font-mono); color: var(--fg); }
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
</style>

<div class="tv-tiles">
  <div class="tv-tile"><div class="tv-tile__title">Total requests</div><div class="tv-tile__value">${input.summary.total}</div></div>
  <div class="tv-tile ${input.summary.errors > 0 ? "tv-tile--bad" : ""}"><div class="tv-tile__title">Server errors (5xx)</div><div class="tv-tile__value">${input.summary.errors}</div></div>
  <div class="tv-tile"><div class="tv-tile__title">Slowest</div><div class="tv-tile__value">${input.summary.slowestMs} ms</div></div>
</div>

<table class="tv-table">
  <thead>
    <tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th><th>Request-Id</th></tr>
  </thead>
  <tbody>
${rows.length > 0 ? rows : '<tr><td colspan="6" style="color:var(--fg-dim);text-align:center;padding:1.5rem">No traces yet — make a request to populate.</td></tr>'}
  </tbody>
</table>
`;

  return renderAdminLayout({
    title: "Traces",
    subtitle: "Recent HTTP request traces (in-memory ring buffer; cleared on dev-server restart).",
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
  return `<tr>
    <td>${escapeHtml(ts)}</td>
    <td><span class="tv-method ${methodClass}">${escapeHtml(t.method)}</span></td>
    <td>${escapeHtml(t.path)}</td>
    <td class="${statusClass}">${t.status}</td>
    <td class="${durClass}">${t.durationMs} ms</td>
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
