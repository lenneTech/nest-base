import type { Features } from "../features/features.js";
import { renderAdminLayout } from "./admin-layout.js";
import { FEATURE_CATALOG, isFeatureActive, summarizeFeatures } from "./feature-catalog.js";

/** `/dev/features` HTML page — feature catalog with on/off + how-to-enable. */
export function renderFeaturesPage(features: Features): string {
  const summary = summarizeFeatures(features);
  const grouped = groupByCategory(features);
  const body = `
<style>
  .feat-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.25rem; }
  .feat-tile {
    background: var(--surface-2); border: 1px solid var(--line);
    border-radius: var(--radius-sm); padding: 1.25rem 1.4rem;
    transition: border-color .25s var(--ease);
  }
  .feat-tile:hover { border-color: var(--line-strong); }
  .feat-tile__label { font-size: .65rem; color: var(--fg-dim); text-transform: uppercase; letter-spacing: .12em; font-weight: 600; }
  .feat-tile__value { font-size: 2rem; font-weight: 600; margin-top: .35rem; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; color: var(--fg); }
  .feat-tile--ok .feat-tile__value { color: var(--accent); }
  .feat-tile--ok { border-color: var(--line-accent); }

  .feat-section__title { font-size: .7rem; color: var(--fg-dim); text-transform: uppercase; letter-spacing: .14em; font-weight: 600; margin: 0 0 .85rem; }

  .feat-grid { display: grid; gap: .85rem; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); }
  .feat-card {
    background: var(--surface-1); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 1.1rem 1.35rem;
    display: flex; flex-direction: column; gap: .6rem;
    transition: all .25s var(--ease);
    position: relative; overflow: hidden;
  }
  .feat-card::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0;
    width: 2px; background: transparent;
  }
  .feat-card[data-on="true"]::before { background: var(--accent); box-shadow: 0 0 8px var(--accent-glow); }
  .feat-card:hover { border-color: var(--line-strong); transform: translateY(-1px); }
  .feat-card__head { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
  .feat-card__name { font-size: 1rem; font-weight: 600; color: var(--fg); letter-spacing: -0.01em; }
  .feat-card__state {
    font-size: .62rem; font-weight: 700; letter-spacing: .14em;
    padding: .2rem .65rem; border-radius: 4px;
  }
  .feat-card[data-on="true"] .feat-card__state { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--line-accent); }
  .feat-card[data-on="false"] .feat-card__state { background: var(--surface-3); color: var(--fg-faint); border: 1px solid var(--line); }
  .feat-card__desc { color: var(--fg-muted); font-size: .85rem; line-height: 1.55; }
  .feat-card__exposes { font-size: .7rem; color: var(--fg-dim); }
  .feat-card__exposes code {
    background: var(--surface-3); color: var(--accent);
    padding: .12rem .45rem; border-radius: 4px;
    font-size: .72rem; margin-right: .35rem;
  }
  .feat-card__env {
    display: flex; align-items: center; gap: .5rem;
    margin-top: .35rem; padding-top: .65rem; border-top: 1px solid var(--line);
    font-size: .72rem; color: var(--fg-dim);
  }
  .feat-card__env code {
    background: var(--surface-2); color: var(--fg);
    padding: .25rem .55rem; border-radius: 4px;
    font-size: .72rem; font-family: var(--font-mono);
    border: 1px solid var(--line);
  }
  .feat-card__env-state { color: var(--fg-faint); }
  .feat-card[data-on="true"] .feat-card__env-state { color: var(--accent); }
</style>

<div class="feat-summary">
  <div class="feat-tile feat-tile--ok">
    <span class="feat-tile__label">Active</span>
    <span class="feat-tile__value">${summary.active}</span>
  </div>
  <div class="feat-tile">
    <span class="feat-tile__label">Available</span>
    <span class="feat-tile__value">${summary.available}</span>
  </div>
  <div class="feat-tile">
    <span class="feat-tile__label">Total</span>
    <span class="feat-tile__value">${summary.total}</span>
  </div>
</div>

${Object.entries(grouped)
  .map(
    ([category, list]) => `
<div class="admin-card">
  <h3 class="feat-section__title">${escapeHtml(categoryLabel(category))}</h3>
  <div class="feat-grid">
    ${list.map(renderCard).join("\n")}
  </div>
</div>`,
  )
  .join("\n")}

<div class="admin-card">
  <h3 class="feat-section__title">How to toggle</h3>
  <p class="admin-meta">
    Set the <code>FEATURE_*</code> environment variable to <strong>true</strong>, <strong>1</strong>, or <strong>yes</strong> in <code>.env</code> and restart the server.
    The feature flag drives module imports, controller registration, and conditional middleware — see <code>src/core/features/features.ts</code> for the full schema.
  </p>
</div>`;

  return renderAdminLayout({
    title: "Features",
    subtitle: `${summary.active} of ${summary.total} feature flags currently enabled.`,
    currentNav: "features",
    body,
  });
}

interface CategoryGroups {
  [k: string]: Array<{ active: boolean; meta: (typeof FEATURE_CATALOG)[number] }>;
}

function groupByCategory(features: Features): CategoryGroups {
  const groups: CategoryGroups = {};
  for (const meta of FEATURE_CATALOG) {
    const active = isFeatureActive(features, meta.key);
    (groups[meta.category] ??= []).push({ active, meta });
  }
  return groups;
}

function categoryLabel(c: string): string {
  switch (c) {
    case "infrastructure":
      return "Infrastructure";
    case "communication":
      return "Communication";
    case "data":
      return "Data";
    case "integration":
      return "Integration";
    case "observability":
      return "Observability";
    default:
      return c;
  }
}

function renderCard({
  active,
  meta,
}: {
  active: boolean;
  meta: (typeof FEATURE_CATALOG)[number];
}): string {
  const exposes = meta.exposes.map((s) => `<code>${escapeHtml(s)}</code>`).join("");
  return `<div class="feat-card" data-on="${active}" data-feature-key="${escapeHtml(meta.key)}">
    <div class="feat-card__head">
      <span class="feat-card__name">${escapeHtml(meta.label)}</span>
      <span class="feat-card__state">${active ? "ON" : "OFF"}</span>
    </div>
    <p class="feat-card__desc">${escapeHtml(meta.description)}</p>
    <div class="feat-card__exposes">${exposes}</div>
    <div class="feat-card__env">
      <code>${escapeHtml(meta.envKey)}=${active ? "true" : "false"}</code>
      <span class="feat-card__env-state">${active ? "✓ enabled" : "set to true to enable"}</span>
    </div>
  </div>`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
