import type { Features } from "../features/features.js";
import type { LogRecord } from "../observability/logger.js";
import { renderAdminLayout } from "./admin-layout.js";
import type { CoverageReport } from "./coverage-report.js";
import { FEATURE_CATALOG, isFeatureActive, summarizeFeatures } from "./feature-catalog.js";
import type { ServiceProbeResult } from "./service-status.js";
import type { TestSummaryReport } from "./test-summary.js";

/**
 * Cockpit dashboard renderer (`/dev`).
 *
 * Composes everything a developer wants at a glance: overall health,
 * coverage / tests / features stats, service probes, log tail, and
 * an inventory of toggleable features. All pieces feed off the
 * already-existing planners — the renderer is purely presentational.
 */

export interface DashboardInput {
  baseUrl: string;
  uptimeMs: number;
  memory: { heapUsed: number; heapTotal: number; rss: number };
  process: { node: string; bun?: string; platform: string };
  features: Features;
  probes: readonly ServiceProbeResult[];
  coverage: CoverageReport;
  tests: TestSummaryReport;
  logs: readonly LogRecord[];
  logBufferCapacity: number;
  /** Aggregate query stats since dev-server boot — surfaced as a tile. */
  queries: { total: number; slowestMs: number; warnCount: number; badCount: number };
}

export function renderDashboardPage(input: DashboardInput): string {
  const featureSummary = summarizeFeatures(input.features);
  const probesDown = input.probes.filter((p) => p.status === "down").length;
  const overall = computeOverallHealth(input, probesDown);
  const errorLogs = input.logs.filter((r) => r.level >= 50).length;
  const warnLogs = input.logs.filter((r) => r.level === 40).length;

  const body = `
${renderHeroStrip(overall, input)}
${renderStatsGrid(input, featureSummary, errorLogs, warnLogs)}
${renderServiceGrid(input.probes)}
<div class="admin-grid admin-grid--2">
  ${renderLogPreview(input.logs, input.logBufferCapacity, errorLogs, warnLogs)}
  ${renderFeatureOverview(input.features, featureSummary)}
</div>
${renderQuickLinks()}
`;
  return renderAdminLayout({
    title: "Dev Hub",
    subtitle: "Real-time cockpit for everything this server runs.",
    currentNav: "dev-hub",
    body,
  });
}

interface OverallHealth {
  state: "ok" | "warn" | "err";
  label: string;
  detail: string;
}

function computeOverallHealth(input: DashboardInput, probesDown: number): OverallHealth {
  if (probesDown > 0) {
    return {
      state: "err",
      label: "Issues detected",
      detail: `${probesDown} service(s) offline`,
    };
  }
  if (input.coverage.available && !input.coverage.gate.overallOk) {
    return {
      state: "warn",
      label: "Coverage below threshold",
      detail: "core ≥ 90% / modules ≥ 80%",
    };
  }
  if (input.tests.available && !input.tests.totals.success) {
    return {
      state: "err",
      label: "Tests failing",
      detail: `${input.tests.totals.failed} failed`,
    };
  }
  return { state: "ok", label: "All systems operational", detail: "Ready to ship" };
}

function renderHeroStrip(overall: OverallHealth, input: DashboardInput): string {
  const heapPct = Math.round((input.memory.heapUsed / input.memory.heapTotal) * 100);
  const heapMb = (input.memory.heapUsed / (1024 * 1024)).toFixed(1);
  const heapTotalMb = (input.memory.heapTotal / (1024 * 1024)).toFixed(0);
  const stateClass =
    overall.state === "ok" ? "hero--ok" : overall.state === "warn" ? "hero--warn" : "hero--err";
  const stateLabel = overall.state === "ok" ? "OK" : overall.state === "warn" ? "WARN" : "ERR";

  return `
<style>
  .hero {
    background: linear-gradient(135deg, var(--surface-1) 0%, var(--surface-2) 100%);
    border: 1px solid var(--line); border-radius: var(--radius);
    padding: 1.85rem 2rem; margin-bottom: 1.25rem;
    display: grid; grid-template-columns: 1fr auto auto auto auto; gap: 2.5rem;
    align-items: center; position: relative; overflow: hidden;
  }
  .hero::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
    background: var(--accent); box-shadow: 0 0 16px var(--accent-glow);
  }
  .hero--warn::before { background: var(--warn); box-shadow: 0 0 16px rgba(251,191,36,.5); }
  .hero--err::before { background: var(--err); box-shadow: 0 0 16px rgba(248,113,113,.5); }
  .hero__main { display: flex; flex-direction: column; gap: .35rem; }
  .hero__state {
    display: inline-flex; align-items: center; gap: .55rem;
    font-size: .68rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
    color: var(--accent);
  }
  .hero--warn .hero__state { color: var(--warn); }
  .hero--err .hero__state { color: var(--err); }
  .hero__pulse {
    width: 8px; height: 8px; border-radius: 999px;
    background: currentColor; box-shadow: 0 0 8px currentColor;
    animation: pulse 2s ease-in-out infinite;
  }
  .hero__title { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; color: var(--fg); margin: 0; }
  .hero__detail { color: var(--fg-muted); font-size: .92rem; }
  .hero__metric { display: flex; flex-direction: column; gap: .15rem; min-width: 0; }
  .hero__metric-label { font-size: .62rem; color: var(--fg-faint); text-transform: uppercase; letter-spacing: .14em; font-weight: 600; }
  .hero__metric-value { font-size: 1.15rem; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--fg); letter-spacing: -0.01em; }
  .hero__metric-sub { font-size: .7rem; color: var(--fg-dim); font-variant-numeric: tabular-nums; }
  @media (max-width: 1024px) {
    .hero { grid-template-columns: 1fr 1fr; gap: 1.25rem; }
  }
</style>
<div class="hero ${stateClass}">
  <div class="hero__main">
    <span class="hero__state"><span class="hero__pulse"></span>${stateLabel}</span>
    <h2 class="hero__title">${escapeHtml(overall.label)}</h2>
    <span class="hero__detail">${escapeHtml(overall.detail)}</span>
  </div>
  <div class="hero__metric">
    <span class="hero__metric-label">Uptime</span>
    <span class="hero__metric-value">${formatDuration(input.uptimeMs)}</span>
    <span class="hero__metric-sub">since boot</span>
  </div>
  <div class="hero__metric">
    <span class="hero__metric-label">Heap</span>
    <span class="hero__metric-value">${heapMb} MB</span>
    <span class="hero__metric-sub">${heapPct}% of ${heapTotalMb} MB</span>
  </div>
  <div class="hero__metric">
    <span class="hero__metric-label">Node / Bun</span>
    <span class="hero__metric-value">${escapeHtml(input.process.bun ?? input.process.node)}</span>
    <span class="hero__metric-sub">${escapeHtml(input.process.platform)}</span>
  </div>
  <div class="hero__metric">
    <span class="hero__metric-label">Base URL</span>
    <span class="hero__metric-value" style="font-size: .85rem; font-family: var(--font-mono);">${escapeHtml(stripProto(input.baseUrl))}</span>
    <span class="hero__metric-sub">portless / loopback</span>
  </div>
</div>`;
}

function renderStatsGrid(
  input: DashboardInput,
  features: { active: number; total: number },
  errorLogs: number,
  warnLogs: number,
): string {
  const covValue = input.coverage.available
    ? `${input.coverage.total?.lines.pct.toFixed(1) ?? "—"}%`
    : "—";
  const covOk = input.coverage.available ? input.coverage.gate.overallOk : null;
  const testsValue = input.tests.available
    ? `${input.tests.totals.passed}/${input.tests.totals.tests}`
    : "—";
  const testsOk = input.tests.available ? input.tests.totals.success : null;

  const querySlow = input.queries.warnCount + input.queries.badCount;
  return `
<style>
  .stat-grid { display: grid; gap: 1rem; grid-template-columns: repeat(5, 1fr); margin-bottom: 1.25rem; }
  .stat-card {
    background: var(--surface-1); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 1.25rem 1.4rem;
    transition: all .25s var(--ease);
    display: flex; flex-direction: column; gap: .35rem;
    color: inherit; position: relative; overflow: hidden;
  }
  .stat-card::after {
    content: "→"; position: absolute; top: 1.25rem; right: 1.4rem;
    color: var(--fg-faint); font-size: 1rem; transition: all .25s var(--ease);
  }
  .stat-card:hover {
    background: var(--surface-2); border-color: var(--line-strong);
    transform: translateY(-2px); text-decoration: none;
  }
  .stat-card:hover::after { color: var(--accent); transform: translateX(2px); }
  .stat-card__label { font-size: .64rem; color: var(--fg-dim); text-transform: uppercase; letter-spacing: .14em; font-weight: 600; }
  .stat-card__value { font-size: 1.85rem; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.025em; color: var(--fg); margin-top: .15rem; }
  .stat-card__pill {
    display: inline-flex; align-items: center; gap: .25rem;
    font-size: .65rem; font-weight: 600; padding: .15rem .55rem;
    border-radius: 999px; text-transform: uppercase; letter-spacing: .08em;
    width: fit-content;
  }
  .stat-card__pill--ok { color: var(--accent); background: var(--accent-soft); border: 1px solid var(--line-accent); }
  .stat-card__pill--bad { color: var(--err); background: rgba(248,113,113,.12); border: 1px solid rgba(248,113,113,.3); }
  .stat-card__pill--warn { color: var(--warn); background: rgba(251,191,36,.12); border: 1px solid rgba(251,191,36,.3); }
  .stat-card__pill--neutral { color: var(--fg-muted); background: var(--surface-2); border: 1px solid var(--line); }
  @media (max-width: 1024px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
<div class="stat-grid">
  <a class="stat-card" href="/dev/coverage">
    <span class="stat-card__label">Coverage</span>
    <span class="stat-card__value">${covValue}</span>
    ${
      covOk === null
        ? '<span class="stat-card__pill stat-card__pill--neutral">no run yet</span>'
        : covOk
          ? '<span class="stat-card__pill stat-card__pill--ok">✓ gates pass</span>'
          : '<span class="stat-card__pill stat-card__pill--warn">below threshold</span>'
    }
  </a>
  <a class="stat-card" href="/dev/tests">
    <span class="stat-card__label">Tests</span>
    <span class="stat-card__value">${testsValue}</span>
    ${
      testsOk === null
        ? '<span class="stat-card__pill stat-card__pill--neutral">no run yet</span>'
        : testsOk
          ? '<span class="stat-card__pill stat-card__pill--ok">✓ all green</span>'
          : `<span class="stat-card__pill stat-card__pill--bad">${input.tests.totals.failed} failing</span>`
    }
  </a>
  <a class="stat-card" href="/dev/features">
    <span class="stat-card__label">Features</span>
    <span class="stat-card__value">${features.active}<span style="font-size: 1rem; color: var(--fg-dim);"> / ${features.total}</span></span>
    <span class="stat-card__pill stat-card__pill--neutral">${features.total - features.active} available</span>
  </a>
  <a class="stat-card" href="/dev/logs">
    <span class="stat-card__label">Recent Logs</span>
    <span class="stat-card__value">${input.logs.length}</span>
    ${
      errorLogs > 0
        ? `<span class="stat-card__pill stat-card__pill--bad">${errorLogs} error${errorLogs === 1 ? "" : "s"}</span>`
        : warnLogs > 0
          ? `<span class="stat-card__pill stat-card__pill--warn">${warnLogs} warn${warnLogs === 1 ? "" : "s"}</span>`
          : '<span class="stat-card__pill stat-card__pill--ok">clean</span>'
    }
  </a>
  <a class="stat-card" href="/dev/queries">
    <span class="stat-card__label">DB Queries</span>
    <span class="stat-card__value">${input.queries.total}</span>
    ${
      input.queries.badCount > 0
        ? `<span class="stat-card__pill stat-card__pill--bad">${input.queries.badCount} critical (&gt; 200 ms)</span>`
        : querySlow > 0
          ? `<span class="stat-card__pill stat-card__pill--warn">${querySlow} slow (&gt; 50 ms)</span>`
          : input.queries.total > 0
            ? '<span class="stat-card__pill stat-card__pill--ok">all fast</span>'
            : '<span class="stat-card__pill stat-card__pill--neutral">no queries yet</span>'
    }
  </a>
</div>`;
}

function renderServiceGrid(probes: readonly ServiceProbeResult[]): string {
  return `
<style>
  .svc-grid { display: grid; gap: .85rem; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .svc {
    background: var(--surface-2); border: 1px solid var(--line);
    border-radius: var(--radius-sm); padding: 1rem 1.15rem;
    display: flex; flex-direction: column; gap: .5rem;
    transition: all .25s var(--ease);
    position: relative; overflow: hidden;
    color: inherit;
  }
  .svc::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0;
    width: 2px; background: transparent; transition: background .2s var(--ease);
  }
  .svc:hover {
    background: var(--surface-3); border-color: var(--line-strong);
    transform: translateY(-2px); text-decoration: none;
    box-shadow: 0 8px 24px rgba(0,0,0,.4);
  }
  .svc[data-status="up"]:hover::before { background: var(--accent); box-shadow: 0 0 8px var(--accent-glow); }
  .svc[data-status="down"]:hover::before { background: var(--err); }
  .svc__head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
  .svc__label { font-weight: 600; color: var(--fg); font-size: .92rem; letter-spacing: -0.005em; }
  .svc__dot { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; }
  .svc__dot--up { background: var(--accent); box-shadow: 0 0 10px var(--accent-glow); animation: pulse 2s ease-in-out infinite; }
  .svc__dot--down { background: var(--err); box-shadow: 0 0 6px rgba(248,113,113,.4); }
  .svc__dot--unknown { background: var(--fg-faint); }
  .svc__url { color: var(--fg-dim); font-size: .72rem; font-family: var(--font-mono); word-break: break-all; line-height: 1.5; }
  .svc__meta {
    color: var(--fg-faint); font-size: .65rem;
    display: flex; justify-content: space-between; align-items: center;
    padding-top: .35rem; border-top: 1px solid var(--line); margin-top: .15rem;
    text-transform: uppercase; letter-spacing: .1em; font-weight: 600;
  }
  .svc__meta span:last-child { color: var(--fg-muted); font-variant-numeric: tabular-nums; }
</style>
<div class="admin-card">
  <h2 class="admin-card__title">Services</h2>
  <div class="svc-grid" data-service-status="true">
    ${probes
      .map((p) => {
        const dotCls =
          p.status === "up"
            ? "svc__dot--up"
            : p.status === "down"
              ? "svc__dot--down"
              : "svc__dot--unknown";
        const labelText =
          p.status === "up" ? "online" : p.status === "down" ? "offline" : "unknown";
        const latency = p.latencyMs !== undefined ? `${p.latencyMs} ms` : "";
        const href = p.href ?? p.probeUrl ?? "#";
        const url = p.probeUrl ?? p.href ?? "";
        return `<a class="svc" href="${escapeHtml(href)}" target="_blank" rel="noopener" data-service-id="${escapeHtml(p.id)}" data-status="${p.status}">
      <div class="svc__head">
        <span class="svc__label">${escapeHtml(p.label)}</span>
        <span class="svc__dot ${dotCls}" title="${labelText}"></span>
      </div>
      ${url ? `<span class="svc__url">${escapeHtml(url)}</span>` : ""}
      <div class="svc__meta">
        <span data-svc-state>${labelText}</span>
        <span data-svc-latency>${latency}</span>
      </div>
    </a>`;
      })
      .join("\n")}
  </div>
</div>
<script>
(function() {
  // Poll /dev/status.json every 4s and update each card in place.
  // This is what makes Prisma Studio "go green" a few seconds after
  // bun run dev (the snapshot server takes ~5s to bind), without a
  // page refresh.
  const grid = document.querySelector('[data-service-status="true"]');
  if (!grid) return;
  const STATE_LABEL = { up: 'online', down: 'offline', unknown: 'unknown' };
  async function tick() {
    try {
      const r = await fetch('/dev/status.json', { cache: 'no-store' });
      if (!r.ok) return;
      const probes = await r.json();
      for (const p of probes) {
        const card = grid.querySelector('[data-service-id="' + p.id + '"]');
        if (!card) continue;
        card.setAttribute('data-status', p.status);
        const dot = card.querySelector('.svc__dot');
        if (dot) {
          dot.classList.remove('svc__dot--up', 'svc__dot--down', 'svc__dot--unknown');
          dot.classList.add('svc__dot--' + p.status);
          dot.title = STATE_LABEL[p.status] || p.status;
        }
        const state = card.querySelector('[data-svc-state]');
        if (state) state.textContent = STATE_LABEL[p.status] || p.status;
        const latency = card.querySelector('[data-svc-latency]');
        if (latency) latency.textContent = p.latencyMs !== undefined ? p.latencyMs + ' ms' : '';
      }
    } catch (_e) { /* ignore — next tick will retry */ }
  }
  setInterval(tick, 4000);
  // Plus a quick second poll 1.5s after the page paints — catches
  // "Prisma Studio just came up" without waiting the full 4s.
  setTimeout(tick, 1500);
})();
</script>`;
}

function renderLogPreview(
  records: readonly LogRecord[],
  capacity: number,
  errorLogs: number,
  warnLogs: number,
): string {
  const rows = records
    .slice(-10)
    .reverse()
    .map((r) => {
      const level = levelName(r.level);
      const time = new Date(r.time).toISOString().slice(11, 19);
      const ctx = r.context ? `[${escapeHtml(String(r.context))}]` : "";
      const msg = escapeHtml(String(r.msg ?? ""));
      return `<tr class="dash-log dash-log--${level}">
        <td class="dash-log__time">${escapeHtml(time)}</td>
        <td class="dash-log__level"><span class="dash-log__chip dash-log__chip--${level}">${level}</span></td>
        <td class="dash-log__msg"><span class="dash-log__ctx">${ctx}</span> ${msg}</td>
      </tr>`;
    })
    .join("\n");

  return `
<style>
  .dash-log__time { color: var(--fg-dim); font-family: var(--font-mono); font-size: .72rem; white-space: nowrap; }
  .dash-log__level { white-space: nowrap; }
  .dash-log__msg { color: var(--fg-muted); font-family: var(--font-mono); font-size: .76rem; line-height: 1.5; }
  .dash-log--warn td { background: rgba(251,191,36,.04); }
  .dash-log--error td, .dash-log--fatal td { background: rgba(248,113,113,.05); color: var(--fg); }
  .dash-log__ctx { color: var(--accent); opacity: .85; }
  .dash-log__chip {
    display: inline-block; padding: .1rem .5rem; border-radius: 4px;
    font-weight: 600; font-size: .6rem; text-transform: uppercase;
    letter-spacing: .1em; border: 1px solid transparent;
  }
  .dash-log__chip--trace, .dash-log__chip--debug { background: var(--surface-3); color: var(--fg-dim); }
  .dash-log__chip--info { background: var(--surface-3); color: var(--fg-muted); border-color: var(--line); }
  .dash-log__chip--warn { background: rgba(251,191,36,.12); color: var(--warn); border-color: rgba(251,191,36,.3); }
  .dash-log__chip--error, .dash-log__chip--fatal { background: rgba(248,113,113,.12); color: var(--err); border-color: rgba(248,113,113,.3); }
</style>
<div class="admin-card">
  <h2 class="admin-card__title">
    Live logs
    <span style="font-size: .7rem; color: var(--fg-dim); font-weight: 500; letter-spacing: .04em;">last 10 of ${records.length}/${capacity}</span>
    ${errorLogs > 0 ? `<span class="stat-card__pill stat-card__pill--bad">${errorLogs} error${errorLogs === 1 ? "" : "s"}</span>` : ""}
    ${warnLogs > 0 && errorLogs === 0 ? `<span class="stat-card__pill stat-card__pill--warn">${warnLogs} warn${warnLogs === 1 ? "" : "s"}</span>` : ""}
    <a href="/dev/logs" style="margin-left: auto; font-size: .75rem; color: var(--fg-dim);">Open full log →</a>
  </h2>
  ${
    records.length === 0
      ? '<div class="admin-empty">No log records yet.</div>'
      : `<table class="admin-table" style="font-size: .8rem;"><tbody>${rows}</tbody></table>`
  }
</div>`;
}

function renderFeatureOverview(
  features: Features,
  summary: { active: number; available: number; total: number },
): string {
  const items = FEATURE_CATALOG.map((meta) => {
    const active = isFeatureActive(features, meta.key);
    const stateClass = active ? "feat-row--on" : "feat-row--off";
    const stateLabel = active ? "ON" : "OFF";
    return `<li class="feat-row ${stateClass}" title="${escapeHtml(meta.description)}">
      <span class="feat-row__label">${escapeHtml(meta.label)}</span>
      <span class="feat-row__chip">${stateLabel}</span>
    </li>`;
  }).join("\n");

  return `
<style>
  .feat-grid { list-style: none; padding: 0; margin: 0; display: grid; gap: .35rem; }
  .feat-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: .55rem .85rem; border-radius: 6px;
    background: var(--surface-2); border: 1px solid var(--line);
    transition: all .15s var(--ease);
    cursor: help;
  }
  .feat-row:hover { background: var(--surface-3); border-color: var(--line-strong); }
  .feat-row__label { color: var(--fg); font-size: .85rem; font-weight: 500; letter-spacing: -0.005em; }
  .feat-row__chip {
    font-size: .62rem; font-weight: 700; letter-spacing: .12em;
    padding: .15rem .5rem; border-radius: 4px;
  }
  .feat-row--on .feat-row__chip { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--line-accent); }
  .feat-row--off .feat-row__chip { background: var(--surface-3); color: var(--fg-faint); border: 1px solid var(--line); }
  .feat-row--on .feat-row__label { color: var(--fg); }
  .feat-row--off .feat-row__label { color: var(--fg-muted); }
</style>
<div class="admin-card">
  <h2 class="admin-card__title">
    Features
    <span style="font-size: .7rem; color: var(--fg-dim); font-weight: 500; letter-spacing: .04em;">${summary.active} / ${summary.total} active</span>
    <a href="/dev/features" style="margin-left: auto; font-size: .75rem; color: var(--fg-dim);">Manage →</a>
  </h2>
  <ul class="feat-grid">${items}</ul>
</div>`;
}

function renderQuickLinks(): string {
  return `
<style>
  .quick-grid { display: grid; gap: .65rem; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .quick {
    display: flex; flex-direction: column; gap: .25rem;
    padding: 1rem 1.15rem; border-radius: var(--radius-sm);
    background: var(--surface-2); border: 1px solid var(--line);
    transition: all .15s var(--ease);
    color: inherit;
  }
  .quick:hover { background: var(--surface-3); border-color: var(--line-accent); transform: translateX(2px); text-decoration: none; }
  .quick__title { font-weight: 600; color: var(--fg); font-size: .9rem; display: flex; align-items: center; justify-content: space-between; }
  .quick__title::after { content: "→"; color: var(--fg-faint); transition: color .15s; }
  .quick:hover .quick__title::after { color: var(--accent); }
  .quick__hint { color: var(--fg-dim); font-size: .76rem; }
</style>
<div class="admin-card">
  <h2 class="admin-card__title">Quick navigation</h2>
  <div class="quick-grid">
    <a class="quick" href="/api/docs"><span class="quick__title">Scalar API Reference</span><span class="quick__hint">Interactive OpenAPI 3.1 reference</span></a>
    <a class="quick" href="/api/openapi"><span class="quick__title">OpenAPI Spec</span><span class="quick__hint">Pretty-printed JSON viewer + raw download</span></a>
    <a class="quick" href="/admin/permissions/test"><span class="quick__title">Permission Tester</span><span class="quick__hint">Resolve CASL ability per user</span></a>
    <a class="quick" href="/admin/webhooks"><span class="quick__title">Webhook Inspector</span><span class="quick__hint">Recent deliveries + replay</span></a>
    <a class="quick" href="/admin/realtime"><span class="quick__title">Realtime Inspector</span><span class="quick__hint">Active sockets + events</span></a>
    <a class="quick" href="/admin/audit"><span class="quick__title">Audit Browser</span><span class="quick__hint">Filter audit-log entries</span></a>
    <a class="quick" href="/admin/search"><span class="quick__title">Search Tester</span><span class="quick__hint">FTS query + tsquery debug</span></a>
    <a class="quick" href="/errors"><span class="quick__title">Error Catalog</span><span class="quick__hint">All CORE_* error codes</span></a>
    <a class="quick" href="/dev/postgrest-parse?status=eq.draft&age=gte.18"><span class="quick__title">PostgREST Parser</span><span class="quick__hint">Try the WHERE-clause parser</span></a>
    <a class="quick" href="/dev/diagnostics"><span class="quick__title">Diagnostics</span><span class="quick__hint">Memory, versions, runtime</span></a>
  </div>
</div>`;
}

function levelName(level: number): string {
  if (level >= 60) return "fatal";
  if (level >= 50) return "error";
  if (level >= 40) return "warn";
  if (level >= 30) return "info";
  if (level >= 20) return "debug";
  return "trace";
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

function stripProto(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
