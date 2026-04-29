import { renderAdminLayout } from "./admin-layout.js";
import type { CoverageFileRow, CoverageReport } from "./coverage-report.js";

/**
 * Coverage dashboard renderer.
 *
 * Pure HTML for `/dev/coverage`. Reads a CoverageReport produced by the
 * planner and emits totals + a per-file table sorted by worst-first
 * lines coverage. Empty state when no run has been recorded yet.
 */
export function renderCoveragePage(report: CoverageReport): string {
  const body = report.available ? renderAvailable(report) : renderEmpty();
  return renderAdminLayout({
    title: "Coverage",
    subtitle: report.available
      ? `Vitest + V8 — generated ${escapeHtml(report.generatedAt ?? "")}`
      : "Run `bun run test:coverage` to populate this page.",
    currentNav: "coverage",
    body,
  });
}

function renderEmpty(): string {
  return `<div class="admin-empty">
    Coverage report not generated yet.<br>
    Run <code>bun run test:coverage</code> to populate the dashboard.
  </div>`;
}

function renderAvailable(report: CoverageReport): string {
  return `
<style>
  .cov-totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
  .cov-tile { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; }
  .cov-tile__label { color: var(--text-muted); font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 600; }
  .cov-tile__value { font-size: 1.85rem; font-weight: 600; margin-top: .25rem; font-variant-numeric: tabular-nums; }
  .cov-tile__bar { height: 4px; background: var(--bg-elevated-2); border-radius: 999px; margin-top: .5rem; overflow: hidden; }
  .cov-tile__fill { height: 100%; transition: width .25s; }
  .cov-tile__fill--ok { background: var(--success); }
  .cov-tile__fill--warn { background: var(--warning); }
  .cov-tile__fill--bad { background: var(--danger); }
  .cov-gate { display: inline-flex; padding: .25rem .65rem; border-radius: 999px; font-size: .75rem; font-weight: 500; margin-left: .5rem; }
  .cov-gate--ok { background: rgba(63, 185, 80, .15); color: var(--success); }
  .cov-gate--bad { background: rgba(248, 81, 73, .15); color: var(--danger); }
  .cov-tier { font-size: .7rem; padding: .15rem .45rem; border-radius: 4px; background: var(--bg-elevated-2); color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
  .cov-pct { font-variant-numeric: tabular-nums; font-weight: 500; }
  .cov-pct--bad { color: var(--danger); }
  .cov-pct--warn { color: var(--warning); }
  .cov-pct--ok { color: var(--success); }
</style>

<div class="admin-card">
  <h2 class="admin-card__title">
    Totals
    ${renderGateBadge("Core ≥ " + report.thresholds.core + "%", report.gate.coreOk)}
    ${renderGateBadge("Modules ≥ " + report.thresholds.modules + "%", report.gate.modulesOk)}
  </h2>
  <div class="cov-totals">
    ${renderTile("Lines", report.total?.lines.pct)}
    ${renderTile("Statements", report.total?.statements.pct)}
    ${renderTile("Branches", report.total?.branches.pct)}
    ${renderTile("Functions", report.total?.functions.pct)}
  </div>
</div>

<div class="admin-card">
  <h2 class="admin-card__title">Files (${report.files.length}, schlechteste oben)</h2>
  ${renderFilesTable(report.files)}
</div>
`;
}

function renderTile(label: string, pct: number | undefined): string {
  const value = pct === undefined ? "—" : `${pct.toFixed(2)}%`;
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct ?? 0)) : 0;
  const cls =
    safePct >= 90
      ? "cov-tile__fill--ok"
      : safePct >= 70
        ? "cov-tile__fill--warn"
        : "cov-tile__fill--bad";
  return `<div class="cov-tile">
    <div class="cov-tile__label">${escapeHtml(label)}</div>
    <div class="cov-tile__value">${escapeHtml(value)}</div>
    <div class="cov-tile__bar"><div class="cov-tile__fill ${cls}" style="width: ${safePct}%;"></div></div>
  </div>`;
}

function renderGateBadge(label: string, ok: boolean): string {
  const cls = ok ? "cov-gate--ok" : "cov-gate--bad";
  const symbol = ok ? "✓" : "✗";
  return `<span class="cov-gate ${cls}">${symbol} ${escapeHtml(label)}</span>`;
}

function renderFilesTable(files: CoverageFileRow[]): string {
  if (files.length === 0) {
    return `<div class="admin-empty">No file-level coverage data.</div>`;
  }
  const rows = files.map(renderFileRow).join("\n");
  return `<table class="admin-table" data-coverage-files="true">
<thead><tr>
  <th>File</th>
  <th>Tier</th>
  <th>Lines</th>
  <th>Stmts</th>
  <th>Branches</th>
  <th>Funcs</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function renderFileRow(file: CoverageFileRow): string {
  const safePath = escapeHtml(file.path);
  const supersetAttr = file.meetsThreshold ? "" : ' data-below-threshold="true"';
  return `<tr${supersetAttr}>
    <td><code>${safePath}</code></td>
    <td><span class="cov-tier">${escapeHtml(file.tier)}</span></td>
    <td>${pctCell(file.metrics.lines.pct, file.tier)}</td>
    <td>${pctCell(file.metrics.statements.pct, file.tier)}</td>
    <td>${pctCell(file.metrics.branches.pct, file.tier)}</td>
    <td>${pctCell(file.metrics.functions.pct, file.tier)}</td>
  </tr>`;
}

function pctCell(pct: number, tier: CoverageFileRow["tier"]): string {
  const value = `${pct.toFixed(2)}%`;
  const target = tier === "core" ? 90 : tier === "modules" ? 80 : 0;
  const cls = pct >= target ? "cov-pct--ok" : pct >= target - 10 ? "cov-pct--warn" : "cov-pct--bad";
  return `<span class="cov-pct ${cls}">${escapeHtml(value)}</span>`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
