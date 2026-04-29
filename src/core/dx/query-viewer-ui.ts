import { renderAdminLayout } from "./admin-layout.js";
import {
  BAD_THRESHOLD_MS,
  WARN_THRESHOLD_MS,
  type QueryRecord,
  type QuerySummary,
  type TemplateGroup,
} from "./query-buffer.js";

/**
 * `/dev/queries` HTML page — slowest queries + top SQL templates
 * (rough N+1 detector) + a recent-queries tail.
 */
export function renderQueryViewerPage(input: {
  recent: QueryRecord[];
  slowest: QueryRecord[];
  topTemplates: TemplateGroup[];
  summary: QuerySummary;
}): string {
  const tiles = `
<div class="qv-tiles">
  <div class="qv-tile"><div class="qv-tile__title">Total queries</div><div class="qv-tile__value">${input.summary.total}</div></div>
  <div class="qv-tile ${input.summary.warnCount > 0 ? "qv-tile--warn" : ""}">
    <div class="qv-tile__title">Slow (&gt; ${WARN_THRESHOLD_MS} ms)</div>
    <div class="qv-tile__value">${input.summary.warnCount}</div>
  </div>
  <div class="qv-tile ${input.summary.badCount > 0 ? "qv-tile--bad" : ""}">
    <div class="qv-tile__title">Critical (&gt; ${BAD_THRESHOLD_MS} ms)</div>
    <div class="qv-tile__value">${input.summary.badCount}</div>
  </div>
  <div class="qv-tile"><div class="qv-tile__title">Slowest</div><div class="qv-tile__value">${Math.round(input.summary.slowestMs)} ms</div></div>
</div>`;

  const slowestRows = input.slowest.map((q) => renderQueryRow(q)).join("\n");

  const templateRows = input.topTemplates.map((g) => renderTemplateRow(g)).join("\n");

  const recentRows = input.recent
    .slice()
    .reverse()
    .slice(0, 50)
    .map((q) => renderQueryRow(q))
    .join("\n");

  const body = `
<style>
  .qv-tiles { display: grid; gap: 1rem; grid-template-columns: repeat(4, 1fr); margin-bottom: 1.5rem; }
  @media (max-width: 900px) { .qv-tiles { grid-template-columns: repeat(2, 1fr); } }
  .qv-tile { background: var(--surface-1); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.25rem; }
  .qv-tile--warn { border-color: rgba(251,191,36,.4); }
  .qv-tile--bad { border-color: var(--err); box-shadow: 0 0 0 1px rgba(248,113,113,.2); }
  .qv-tile__title { font-size: .65rem; color: var(--fg-dim); text-transform: uppercase; letter-spacing: .14em; font-weight: 600; }
  .qv-tile__value { font-size: 1.6rem; font-family: var(--font-mono); margin-top: .35rem; color: var(--fg); }

  .qv-section { background: var(--surface-1); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
  .qv-section h2 { font-size: .98rem; font-weight: 600; margin: 0 0 1rem; color: var(--fg); }
  .qv-section__hint { color: var(--fg-muted); font-size: .8rem; margin: 0 0 1rem; max-width: 70ch; }

  .qv-table { width: 100%; border-collapse: collapse; font-size: .8rem; font-family: var(--font-mono); }
  .qv-table th, .qv-table td { text-align: left; padding: .45rem .75rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  .qv-table th { color: var(--fg-dim); font-weight: 600; font-size: .68rem; text-transform: uppercase; letter-spacing: .1em; font-family: inherit; white-space: nowrap; }
  .qv-table td { color: var(--fg); }
  /* Numeric columns: tabular-nums + right-aligned so values line up. */
  .qv-table td.qv-num, .qv-table th.qv-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

  .qv-sql { white-space: pre-wrap; word-break: break-all; }
  .qv-dur--slow { color: #fcd34d; }
  .qv-dur--bad { color: #fca5a5; font-weight: 600; }
  .qv-count--high { color: #fca5a5; font-weight: 600; }

  .qv-empty { padding: 1.5rem; text-align: center; color: var(--fg-dim); }
</style>

${tiles}

<section class="qv-section">
  <h2>Slowest queries (top 10)</h2>
  <p class="qv-section__hint">Queries above ${WARN_THRESHOLD_MS} ms get a warning tint, above ${BAD_THRESHOLD_MS} ms an error tint. If a slice you just shipped lands here, that's your next thing to fix.</p>
  ${
    slowestRows
      ? `<table class="qv-table">
          <colgroup><col style="width:7rem"/><col/></colgroup>
          <thead><tr><th class="qv-num">Duration</th><th>SQL</th></tr></thead>
          <tbody>${slowestRows}</tbody>
        </table>`
      : '<div class="qv-empty">No queries yet — make a request that hits the DB.</div>'
  }
</section>

<section class="qv-section">
  <h2>Most frequent templates (rough N+1 detector)</h2>
  <p class="qv-section__hint">Templates that fire many times in a session usually mean a missing <code>include:</code> — the loop is round-tripping per row. The sample column shows the most recent occurrence so you can grep for it.</p>
  ${
    templateRows
      ? `<table class="qv-table">
          <colgroup><col style="width:5rem"/><col style="width:7rem"/><col/></colgroup>
          <thead><tr><th class="qv-num">Count</th><th class="qv-num">Total</th><th>Sample</th></tr></thead>
          <tbody>${templateRows}</tbody>
        </table>`
      : '<div class="qv-empty">Empty buffer.</div>'
  }
</section>

<section class="qv-section">
  <h2>Recent (newest first, last 50)</h2>
  ${
    recentRows
      ? `<table class="qv-table">
          <colgroup><col style="width:7rem"/><col/></colgroup>
          <thead><tr><th class="qv-num">Duration</th><th>SQL</th></tr></thead>
          <tbody>${recentRows}</tbody>
        </table>`
      : '<div class="qv-empty">Empty buffer.</div>'
  }
</section>
`;

  return renderAdminLayout({
    title: "Queries",
    subtitle:
      "In-memory ring buffer of every Prisma query event this server emitted. Cleared on dev-server restart.",
    currentNav: "queries",
    body,
  });
}

function renderQueryRow(q: QueryRecord): string {
  const durClass =
    q.durationMs > BAD_THRESHOLD_MS
      ? "qv-dur--bad"
      : q.durationMs > WARN_THRESHOLD_MS
        ? "qv-dur--slow"
        : "";
  return `<tr>
    <td class="qv-num ${durClass}">${formatMs(q.durationMs)}</td>
    <td class="qv-sql">${escapeHtml(q.sql)}</td>
  </tr>`;
}

function renderTemplateRow(g: TemplateGroup): string {
  const countClass = g.count >= 10 ? "qv-count--high" : "";
  return `<tr>
    <td class="qv-num ${countClass}">${g.count}</td>
    <td class="qv-num">${formatMs(g.totalMs)}</td>
    <td class="qv-sql">${escapeHtml(g.sample)}</td>
  </tr>`;
}

/**
 * Render a millisecond duration. Sub-1 ms gets one decimal; everything
 * else is rounded to a whole number — Prisma's `event.duration` can
 * carry microsecond precision that is just visual noise in a table.
 */
function formatMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
