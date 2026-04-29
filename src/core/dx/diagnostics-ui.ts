import { renderAdminLayout } from "./admin-layout.js";
import type { DiagnosticsReport } from "./diagnostics.js";

/** `/dev/diagnostics` HTML page — runtime, memory, versions, feature roster. */
export function renderDiagnosticsPage(report: DiagnosticsReport): string {
  const heap = report.process.memory;
  // Defensive percentage math:
  //   - guard against `heapTotal === 0` (NaN / Infinity)
  //   - clamp to [0, 100] so the bar never overflows its track
  //
  // Why the clamp matters: under Bun (JavaScriptCore) the
  // `process.memoryUsage()` `heapUsed` and `heapTotal` come from
  // different counters and can briefly disagree — `heapUsed` can
  // exceed `heapTotal` because JSC's allocator has handed out
  // cells the committed-page accounting hasn't caught up to yet.
  // We use `max(used, total)` as the denominator so the displayed
  // percentage is always sensible. Raw numbers stay visible below
  // the bar for debugging.
  const heapDenominator = Math.max(heap.heapUsed, heap.heapTotal);
  const heapPct =
    heapDenominator > 0 ? Math.min(100, Math.round((heap.heapUsed / heapDenominator) * 100)) : 0;
  const heapOverflow = heap.heapUsed > heap.heapTotal && heap.heapTotal > 0;
  const uptimeMs = report.process.uptimeSeconds * 1000;
  const body = `
<style>
  .diag-grid { display: grid; gap: 1rem; grid-template-columns: repeat(2, 1fr); }
  .diag-grid--3 { grid-template-columns: repeat(3, 1fr); }
  @media (max-width: 900px) { .diag-grid, .diag-grid--3 { grid-template-columns: 1fr; } }
  .diag-card { background: var(--surface-1); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.5rem 1.75rem; }
  .diag-card__title { font-size: .65rem; color: var(--fg-dim); text-transform: uppercase; letter-spacing: .14em; font-weight: 600; margin: 0 0 1rem; }
  .diag-row { display: flex; justify-content: space-between; align-items: baseline; padding: .55rem 0; border-bottom: 1px solid var(--line); }
  .diag-row:last-child { border-bottom: 0; }
  .diag-row__label { color: var(--fg-muted); font-size: .85rem; }
  .diag-row__value { color: var(--fg); font-family: var(--font-mono); font-size: .85rem; font-variant-numeric: tabular-nums; }

  .diag-bar-wrap {
    display: flex; flex-direction: column; gap: .5rem;
    margin-top: .25rem;
  }
  .diag-bar-row {
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: .8rem;
  }
  .diag-bar-row span:first-child { color: var(--fg-muted); }
  .diag-bar-row span:last-child { color: var(--fg); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .diag-bar { height: 6px; background: var(--surface-3); border-radius: 999px; overflow: hidden; }
  .diag-bar__fill {
    height: 100%; border-radius: inherit; transition: width .6s var(--ease);
    background: var(--accent); box-shadow: 0 0 12px var(--accent-glow);
  }
  .diag-bar__fill--warn { background: var(--warn); box-shadow: 0 0 12px rgba(251,191,36,.4); }
  .diag-bar__fill--bad { background: var(--err); box-shadow: 0 0 12px rgba(248,113,113,.4); }

  .diag-pill {
    display: inline-flex; align-items: center; gap: .3rem;
    padding: .15rem .55rem; border-radius: 999px;
    font-size: .65rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
    background: var(--accent-soft); color: var(--accent);
    border: 1px solid var(--line-accent);
  }
</style>

<div class="diag-grid">
  <div class="diag-card">
    <h3 class="diag-card__title">Runtime</h3>
    <div class="diag-bar-wrap">
      <div class="diag-bar-row"><span>Heap pressure</span><span>${formatBytes(heap.heapUsed)} / ${formatBytes(heap.heapTotal)} (${heapPct}%)</span></div>
      <div class="diag-bar"><div class="diag-bar__fill ${heapPct > 90 ? "diag-bar__fill--bad" : heapPct > 70 ? "diag-bar__fill--warn" : ""}" style="width: ${heapPct}%"></div></div>
    </div>
    <div class="diag-row"><span class="diag-row__label">Heap used</span><span class="diag-row__value">${formatBytes(heap.heapUsed)}</span></div>
    <div class="diag-row"><span class="diag-row__label">Heap committed</span><span class="diag-row__value">${formatBytes(heap.heapTotal)}</span></div>
    ${
      heapOverflow
        ? `<div class="diag-row" style="border-bottom:0;padding:.35rem 0 0;"><span class="diag-row__label" style="font-size:.72rem;color:var(--fg-dim);">Heap used &gt; committed — Bun's JSC heap accounting can show this briefly. Not a leak.</span></div>`
        : ""
    }
    <div class="diag-row"><span class="diag-row__label">RSS</span><span class="diag-row__value">${formatBytes(heap.rss)}</span></div>
    <div class="diag-row"><span class="diag-row__label">External</span><span class="diag-row__value">${formatBytes(heap.external)}</span></div>
    <div class="diag-row"><span class="diag-row__label">Array Buffers</span><span class="diag-row__value">${formatBytes(heap.arrayBuffers)}</span></div>
    <div class="diag-row"><span class="diag-row__label">Uptime</span><span class="diag-row__value">${formatDuration(uptimeMs)}</span></div>
  </div>

  <div class="diag-card">
    <h3 class="diag-card__title">Environment</h3>
    <div class="diag-row"><span class="diag-row__label">App env</span><span class="diag-row__value"><span class="diag-pill">${escapeHtml(report.app.env)}</span></span></div>
    <div class="diag-row"><span class="diag-row__label">Version</span><span class="diag-row__value">${escapeHtml(report.app.version)}</span></div>
    <div class="diag-row"><span class="diag-row__label">Base URL</span><span class="diag-row__value">${escapeHtml(report.app.baseUrl)}</span></div>
    <div class="diag-row"><span class="diag-row__label">Node</span><span class="diag-row__value">${escapeHtml(report.runtime.nodeVersion)}</span></div>
    ${report.runtime.bunVersion ? `<div class="diag-row"><span class="diag-row__label">Bun</span><span class="diag-row__value">${escapeHtml(report.runtime.bunVersion)}</span></div>` : ""}
    <div class="diag-row"><span class="diag-row__label">Platform</span><span class="diag-row__value">${escapeHtml(report.runtime.platform)} / ${escapeHtml(report.runtime.arch)}</span></div>
  </div>
</div>

<div class="admin-card" style="margin-top: 1.25rem;">
  <h3 class="diag-card__title">Active features</h3>
  <div class="diag-grid diag-grid--3">
    ${Object.entries(report.features)
      .filter(([k]) => k !== "authMethods" && k !== "socialProviders")
      .map(([k, v]) => {
        const isOn = Boolean(v);
        return `<div class="diag-row">
          <span class="diag-row__label">${escapeHtml(k)}</span>
          <span class="diag-row__value"><span class="diag-pill" style="${
            isOn
              ? ""
              : "background: var(--surface-3); color: var(--fg-faint); border-color: var(--line);"
          }">${isOn ? "ON" : "OFF"}</span></span>
        </div>`;
      })
      .join("\n")}
  </div>
</div>

<div class="admin-card" style="margin-top: 1.25rem;">
  <h3 class="diag-card__title">Application metadata</h3>
  ${Object.entries(report.dependencies)
    .map(
      ([k, v]) =>
        `<div class="diag-row"><span class="diag-row__label">${escapeHtml(k)}</span><span class="diag-row__value">${escapeHtml(String(v))}</span></div>`,
    )
    .join("\n")}
  <div class="diag-row"><span class="diag-row__label">Generated</span><span class="diag-row__value">${escapeHtml(report.process.now)}</span></div>
</div>`;

  return renderAdminLayout({
    title: "Diagnostics",
    subtitle: "Live runtime, memory, environment, and feature roster.",
    currentNav: "diagnostics",
    body,
  });
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
