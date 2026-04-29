import { renderAdminLayout } from "./admin-layout.js";
import type { RouteGuard, RouteInventory, RouteRecord } from "./route-inventory.js";

/** `/dev/routes` HTML page — every endpoint, with its guard kind. */
export function renderRouteInventoryPage(inventory: RouteInventory): string {
  const summary = inventory.summary;
  const tilePct = (n: number): number =>
    summary.total === 0 ? 0 : Math.round((n / summary.total) * 100);

  const tiles = `
<div class="ri-tiles">
  <div class="ri-tile">
    <div class="ri-tile__title">Total</div>
    <div class="ri-tile__value">${summary.total}</div>
  </div>
  <div class="ri-tile ri-tile--ok">
    <div class="ri-tile__title">Guarded (@Can)</div>
    <div class="ri-tile__value">${summary.guarded} <span class="ri-tile__pct">${tilePct(summary.guarded)}%</span></div>
  </div>
  <div class="ri-tile ri-tile--info">
    <div class="ri-tile__title">Public (allowlist)</div>
    <div class="ri-tile__value">${summary.public} <span class="ri-tile__pct">${tilePct(summary.public)}%</span></div>
  </div>
  <div class="ri-tile ${summary.unguarded > 0 ? "ri-tile--bad" : ""}">
    <div class="ri-tile__title">Unguarded</div>
    <div class="ri-tile__value">${summary.unguarded} <span class="ri-tile__pct">${tilePct(summary.unguarded)}%</span></div>
  </div>
</div>`;

  const rows = inventory.routes.map((r) => renderRow(r)).join("\n");

  const body = `
<style>
  .ri-tiles { display: grid; gap: 1rem; grid-template-columns: repeat(4, 1fr); margin-bottom: 1.5rem; }
  @media (max-width: 900px) { .ri-tiles { grid-template-columns: repeat(2, 1fr); } }
  .ri-tile { background: var(--surface-1); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.25rem; }
  .ri-tile--ok { border-color: var(--line-accent); }
  .ri-tile--info { border-color: rgba(96,165,250,.3); }
  .ri-tile--bad { border-color: var(--err); box-shadow: 0 0 0 1px rgba(248,113,113,.2); }
  .ri-tile__title { font-size: .65rem; color: var(--fg-dim); text-transform: uppercase; letter-spacing: .14em; font-weight: 600; }
  .ri-tile__value { font-size: 1.6rem; font-family: var(--font-mono); margin-top: .35rem; color: var(--fg); }
  .ri-tile__pct { font-size: .8rem; color: var(--fg-muted); margin-left: .35rem; }

  .ri-table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  .ri-table th, .ri-table td { text-align: left; padding: .5rem .75rem; border-bottom: 1px solid var(--line); }
  .ri-table th { color: var(--fg-dim); font-weight: 600; font-size: .7rem; text-transform: uppercase; letter-spacing: .1em; }
  .ri-table td { font-family: var(--font-mono); color: var(--fg); }
  .ri-table tr:hover td { background: var(--surface-2); }

  .ri-method { display: inline-block; padding: .1rem .45rem; border-radius: 4px; font-size: .7rem; font-weight: 600; letter-spacing: .04em; }
  .ri-method--GET { background: rgba(96,165,250,.15); color: #93c5fd; }
  .ri-method--POST { background: rgba(74,222,128,.15); color: #86efac; }
  .ri-method--PATCH, .ri-method--PUT { background: rgba(251,191,36,.15); color: #fcd34d; }
  .ri-method--DELETE { background: rgba(248,113,113,.15); color: #fca5a5; }

  .ri-guard { display: inline-flex; align-items: center; gap: .3rem; padding: .15rem .55rem; border-radius: 999px; font-size: .65rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
  .ri-guard--can { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--line-accent); }
  .ri-guard--public { background: rgba(96,165,250,.12); color: #93c5fd; border: 1px solid rgba(96,165,250,.25); }
  .ri-guard--unguarded { background: rgba(248,113,113,.12); color: #fca5a5; border: 1px solid rgba(248,113,113,.3); }
</style>

${tiles}

<table class="ri-table">
  <thead>
    <tr><th>Method</th><th>Path</th><th>Controller</th><th>Handler</th><th>Guard</th></tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
`;

  return renderAdminLayout({
    title: "Routes",
    subtitle: `${summary.total} endpoint(s) registered. ${
      summary.unguarded > 0
        ? `<strong style="color:var(--err)">${summary.unguarded} unguarded</strong> — review the policy.`
        : "All routes accounted for."
    }`,
    currentNav: "routes",
    body,
  });
}

function renderRow(r: RouteRecord): string {
  const methodClass = `ri-method--${escapeHtml(r.method)}`;
  const guards = r.guards.map((g) => renderGuard(g)).join(" ");
  return `<tr>
    <td><span class="ri-method ${methodClass}">${escapeHtml(r.method)}</span></td>
    <td>${escapeHtml(r.path)}</td>
    <td>${escapeHtml(r.controller)}</td>
    <td>${escapeHtml(r.handler)}</td>
    <td>${guards}</td>
  </tr>`;
}

function renderGuard(g: RouteGuard): string {
  if (g.kind === "can") {
    return `<span class="ri-guard ri-guard--can">@Can(${escapeHtml(g.action)}, ${escapeHtml(g.subject)})</span>`;
  }
  if (g.kind === "public") {
    return `<span class="ri-guard ri-guard--public">public</span>`;
  }
  return `<span class="ri-guard ri-guard--unguarded">unguarded</span>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
