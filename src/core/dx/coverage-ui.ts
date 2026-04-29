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
  .cov-tile {
    background: var(--surface-2); border: 1px solid var(--line);
    border-radius: var(--radius-sm); padding: 1.25rem 1.4rem;
    transition: border-color .25s var(--ease), transform .25s var(--ease);
  }
  .cov-tile:hover { border-color: var(--line-strong); transform: translateY(-1px); }
  .cov-tile__label { color: var(--fg-dim); font-size: .65rem; text-transform: uppercase; letter-spacing: .12em; font-weight: 600; }
  .cov-tile__value { font-size: 2rem; font-weight: 600; margin-top: .35rem; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; color: var(--fg); }
  .cov-tile__bar { height: 4px; background: var(--surface-3); border-radius: 999px; margin-top: .85rem; overflow: hidden; }
  .cov-tile__fill { height: 100%; transition: width .6s var(--ease); border-radius: inherit; }
  .cov-tile__fill--ok { background: var(--accent); box-shadow: 0 0 12px var(--accent-glow); }
  .cov-tile__fill--warn { background: var(--warn); }
  .cov-tile__fill--bad { background: var(--err); }
  .cov-gate { display: inline-flex; align-items: center; gap: .35rem; padding: .25rem .7rem; border-radius: 999px; font-size: .68rem; font-weight: 600; margin-left: .25rem; letter-spacing: .04em; text-transform: uppercase; }
  .cov-gate--ok { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--line-accent); }
  .cov-gate--bad { background: rgba(248, 113, 113, .12); color: var(--err); border: 1px solid rgba(248, 113, 113, .35); }
  .cov-tier { font-size: .65rem; padding: .15rem .55rem; border-radius: 4px; background: var(--surface-3); color: var(--fg-dim); text-transform: uppercase; letter-spacing: .08em; font-weight: 600; }
  .cov-pct { font-variant-numeric: tabular-nums; font-weight: 500; }
  .cov-pct--bad { color: var(--err); }
  .cov-pct--warn { color: var(--warn); }
  .cov-pct--ok { color: var(--accent); }
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
