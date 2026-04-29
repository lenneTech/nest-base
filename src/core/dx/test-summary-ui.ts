import { renderAdminLayout } from "./admin-layout.js";
import type { TestFileRow, TestSummaryReport } from "./test-summary.js";

/**
 * Test-Summary dashboard renderer.
 *
 * Pure HTML for `/dev/tests`. Reads a TestSummaryReport produced by
 * the planner and emits totals + a per-file table. Failed suites
 * float to the top with a red row tint and their first failure
 * message. Empty state when no run has been recorded yet.
 */
export function renderTestSummaryPage(report: TestSummaryReport): string {
  const body = report.available ? renderAvailable(report) : renderEmpty();
  return renderAdminLayout({
    title: "Tests",
    subtitle: report.available
      ? `Vitest ${report.totals.success ? "passed" : "failed"} — ${report.totals.passed}/${report.totals.tests} tests, ${formatDuration(report.totals.durationMs)}`
      : "Run `bun run test:summary` to populate this page.",
    currentNav: "tests",
    body,
  });
}

function renderEmpty(): string {
  return `<div class="admin-empty">
    Test summary not generated yet.<br>
    Run <code>bun run test:summary</code> to populate the dashboard.
  </div>`;
}

function renderAvailable(report: TestSummaryReport): string {
  const t = report.totals;
  return `
<style>
  .test-totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
  .test-tile {
    background: var(--surface-2); border: 1px solid var(--line);
    border-radius: var(--radius-sm); padding: 1.25rem 1.4rem;
    transition: border-color .25s var(--ease), transform .25s var(--ease);
  }
  .test-tile:hover { border-color: var(--line-strong); transform: translateY(-1px); }
  .test-tile__label { color: var(--fg-dim); font-size: .65rem; text-transform: uppercase; letter-spacing: .12em; font-weight: 600; }
  .test-tile__value { font-size: 2rem; font-weight: 600; margin-top: .35rem; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .test-tile--ok .test-tile__value { color: var(--accent); }
  .test-tile--ok { border-color: var(--line-accent); }
  .test-tile--bad .test-tile__value { color: var(--err); }
  .test-tile--neutral .test-tile__value { color: var(--fg); }
  .test-pill { display: inline-flex; align-items: center; gap: .3rem; padding: .25rem .65rem; border-radius: 999px; font-size: .65rem; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; }
  .test-pill--passed { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--line-accent); }
  .test-pill--failed { background: rgba(248, 113, 113, .12); color: var(--err); border: 1px solid rgba(248, 113, 113, .35); }
  .test-row--failed td { background: rgba(248, 113, 113, .04); }
  pre.test-snippet { background: var(--surface-3); padding: .7rem .9rem; border-radius: 6px; border: 1px solid var(--line); margin: .5rem 0 0; font-size: .72rem; white-space: pre-wrap; word-break: break-word; max-height: 8rem; overflow: auto; line-height: 1.5; color: var(--err); }
</style>

<div class="admin-card">
  <h2 class="admin-card__title">
    Totals
    ${
      t.success
        ? '<span class="test-pill test-pill--passed">✓ all green</span>'
        : '<span class="test-pill test-pill--failed">✗ failures</span>'
    }
  </h2>
  <div class="test-totals">
    <div class="test-tile test-tile--neutral">
      <div class="test-tile__label">Tests</div>
      <div class="test-tile__value">${t.tests}</div>
    </div>
    <div class="test-tile test-tile--ok">
      <div class="test-tile__label">Passed</div>
      <div class="test-tile__value">${t.passed}</div>
    </div>
    <div class="test-tile test-tile--bad">
      <div class="test-tile__label">Failed</div>
      <div class="test-tile__value">${t.failed}</div>
    </div>
    <div class="test-tile test-tile--neutral">
      <div class="test-tile__label">Duration</div>
      <div class="test-tile__value">${escapeHtml(formatDuration(t.durationMs))}</div>
    </div>
  </div>
</div>

<div class="admin-card">
  <h2 class="admin-card__title">Files (${report.files.length}, fehler zuerst)</h2>
  ${renderTable(report.files)}
</div>
`;
}

function renderTable(files: TestFileRow[]): string {
  if (files.length === 0) {
    return `<div class="admin-empty">No file-level data in summary.</div>`;
  }
  const rows = files.map(renderRow).join("\n");
  return `<table class="admin-table" data-test-files="true">
<thead><tr>
  <th>Status</th>
  <th>File</th>
  <th>Pass</th>
  <th>Fail</th>
  <th>Skip</th>
  <th>Duration</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function renderRow(file: TestFileRow): string {
  const path = escapeHtml(file.path);
  const cls = file.status === "failed" ? "test-row--failed" : "";
  const pill =
    file.status === "passed"
      ? '<span class="test-pill test-pill--passed">passed</span>'
      : '<span class="test-pill test-pill--failed">failed</span>';
  const snippet = file.failureSnippet
    ? `<pre class="test-snippet">${escapeHtml(file.failureSnippet)}</pre>`
    : "";
  return `<tr class="${cls}">
    <td>${pill}</td>
    <td><code>${path}</code>${snippet}</td>
    <td>${file.passed}</td>
    <td>${file.failed}</td>
    <td>${file.skipped}</td>
    <td>${escapeHtml(formatDuration(file.durationMs))}</td>
  </tr>`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
