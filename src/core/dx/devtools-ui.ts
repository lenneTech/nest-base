import { renderAdminLayout } from "./admin-layout.js";

/**
 * `/dev/devtools` — wiring page for the NestJS Cloud DevTools.
 *
 * The DevtoolsModule starts a local snapshot server on port 8000 (or
 * the configured port). The visualisation lives at
 * https://devtools.nestjs.com which talks to that local server. This
 * page tells the dev which port the snapshot server is bound to, the
 * current liveness status, and provides one-click open of the Cloud UI.
 */

export interface DevtoolsPageInput {
  enabled: boolean;
  port: number;
  /** "up" if probe answered, "down" otherwise. */
  status: "up" | "down" | "unknown";
  cloudUrl: string;
}

export function renderDevtoolsPage(input: DevtoolsPageInput): string {
  const cloudHref =
    input.cloudUrl +
    (input.cloudUrl.includes("?") ? "&" : "?") +
    "url=http%3A%2F%2Flocalhost%3A" +
    input.port;
  const stateColor =
    input.status === "up"
      ? "var(--accent)"
      : input.status === "down"
        ? "var(--err)"
        : "var(--fg-faint)";
  const stateLabel =
    input.status === "up" ? "online" : input.status === "down" ? "offline" : "unknown";
  const body = `
<style>
  .dt-hero {
    background: linear-gradient(135deg, var(--surface-1) 0%, var(--surface-2) 100%);
    border: 1px solid var(--line); border-radius: var(--radius);
    padding: 1.85rem 2rem; margin-bottom: 1.25rem;
    display: grid; grid-template-columns: 1fr auto; gap: 2rem; align-items: center;
    position: relative; overflow: hidden;
  }
  .dt-hero::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
    background: ${stateColor}; box-shadow: 0 0 16px ${stateColor};
  }
  .dt-hero__title { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 .35rem; color: var(--fg); }
  .dt-hero__sub { color: var(--fg-muted); font-size: .92rem; }
  .dt-hero__cta {
    background: var(--accent); color: var(--accent-ink);
    padding: .9rem 1.5rem; border-radius: var(--radius-sm);
    font-weight: 600; font-size: .92rem;
    display: inline-flex; align-items: center; gap: .55rem;
    transition: transform .15s var(--ease), box-shadow .15s var(--ease), filter .15s;
  }
  .dt-hero__cta:hover { filter: brightness(1.05); transform: translateY(-1px); box-shadow: 0 4px 16px var(--accent-glow); color: var(--accent-ink); text-decoration: none; }

  .dt-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.25rem; }
  @media (max-width: 900px) { .dt-grid { grid-template-columns: 1fr; } }
  .dt-tile { background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 1.1rem 1.35rem; }
  .dt-tile__label { font-size: .65rem; color: var(--fg-dim); text-transform: uppercase; letter-spacing: .14em; font-weight: 600; }
  .dt-tile__value { font-size: 1.4rem; font-weight: 600; margin-top: .35rem; font-variant-numeric: tabular-nums; color: var(--fg); letter-spacing: -0.01em; }
  .dt-tile__hint { color: var(--fg-dim); font-size: .78rem; margin-top: .25rem; }
  .dt-status-pill { display: inline-flex; align-items: center; gap: .35rem; padding: .15rem .55rem; border-radius: 999px; font-size: .65rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; border: 1px solid; }
  .dt-status-pill--up { background: var(--accent-soft); color: var(--accent); border-color: var(--line-accent); }
  .dt-status-pill--down { background: rgba(248,113,113,.12); color: var(--err); border-color: rgba(248,113,113,.35); }
  .dt-status-pill--unknown { background: var(--surface-3); color: var(--fg-faint); border-color: var(--line); }

  .dt-step {
    display: flex; gap: 1rem; padding: 1rem 1.25rem;
    border: 1px solid var(--line); border-radius: var(--radius-sm);
    background: var(--surface-2); margin-bottom: .65rem;
  }
  .dt-step__num {
    flex-shrink: 0; width: 28px; height: 28px; border-radius: 999px;
    background: var(--accent); color: var(--accent-ink);
    display: grid; place-items: center; font-weight: 700; font-size: .85rem;
  }
  .dt-step__body p { margin: 0 0 .35rem; color: var(--fg-muted); }
  .dt-step__body code { background: var(--surface-3); padding: .15rem .45rem; border-radius: 4px; color: var(--accent); }
</style>

<div class="dt-hero">
  <div>
    <h2 class="dt-hero__title">NestJS Cloud DevTools</h2>
    <p class="dt-hero__sub">Visualises the dependency graph, controllers, providers, and request lifecycle of this server. Hosted UI talks to the local snapshot server on <code style="color: var(--accent); background: var(--surface-3); padding: .12rem .4rem; border-radius: 4px;">localhost:${input.port}</code>.</p>
  </div>
  ${
    input.enabled
      ? `<a class="dt-hero__cta" href="${escapeAttr(cloudHref)}" target="_blank" rel="noopener">Open Cloud UI ↗</a>`
      : `<span class="dt-status-pill dt-status-pill--unknown">Disabled — set NESTJS_DEVTOOLS=1</span>`
  }
</div>

<div class="dt-grid">
  <div class="dt-tile">
    <span class="dt-tile__label">Snapshot Server</span>
    <span class="dt-tile__value">localhost:${input.port}</span>
    <span class="dt-tile__hint">
      <span class="dt-status-pill dt-status-pill--${input.status}">● ${stateLabel}</span>
    </span>
  </div>
  <div class="dt-tile">
    <span class="dt-tile__label">Activation</span>
    <span class="dt-tile__value">${input.enabled ? "Enabled" : "Disabled"}</span>
    <span class="dt-tile__hint">${
      input.enabled
        ? "DevtoolsModule registered — snapshot endpoint exposed."
        : "Set <code>NESTJS_DEVTOOLS=1</code> in <code>.env</code> and restart."
    }</span>
  </div>
</div>

<div class="admin-card">
  <h2 class="admin-card__title">How to use</h2>
  <div class="dt-step">
    <span class="dt-step__num">1</span>
    <div class="dt-step__body">
      <p><strong>Server is running</strong> with the DevtoolsModule on port <code>${input.port}</code>. Status above shows live connectivity.</p>
    </div>
  </div>
  <div class="dt-step">
    <span class="dt-step__num">2</span>
    <div class="dt-step__body">
      <p><strong>Open the Cloud UI</strong> at <a href="${escapeAttr(input.cloudUrl)}" target="_blank" rel="noopener">${escapeHtml(input.cloudUrl)}</a> — the link above pre-fills your local URL.</p>
    </div>
  </div>
  <div class="dt-step">
    <span class="dt-step__num">3</span>
    <div class="dt-step__body">
      <p><strong>Sign in</strong> with your NestJS account (free tier covers local dev). The UI fetches the snapshot from your local server — no telemetry leaves your machine beyond the graph payload.</p>
    </div>
  </div>
  <div class="dt-step">
    <span class="dt-step__num">4</span>
    <div class="dt-step__body">
      <p><strong>Inspect</strong>: module graph, providers, route tree, REPL, lifecycle hooks. Reload after code changes — <code>bun --watch</code> respawns the server and the Cloud UI re-fetches automatically.</p>
    </div>
  </div>
</div>

<div class="admin-card">
  <h2 class="admin-card__title">Reference</h2>
  <ul class="admin-link-list">
    <li><a href="https://docs.nestjs.com/devtools/overview" target="_blank" rel="noopener"><span>Official documentation</span><span class="admin-meta">↗</span></a></li>
    <li><a href="${escapeAttr(input.cloudUrl)}" target="_blank" rel="noopener"><span>devtools.nestjs.com</span><span class="admin-meta">↗</span></a></li>
    <li><a href="/dev/diagnostics"><span>Server diagnostics (memory, runtime, versions)</span><span class="admin-meta">→</span></a></li>
  </ul>
</div>
`;
  return renderAdminLayout({
    title: "NestJS DevTools",
    subtitle: "Module graph, providers, and request lifecycle visualisation.",
    currentNav: "nest-devtools",
    body,
  });
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(input: string): string {
  return escapeHtml(input);
}
