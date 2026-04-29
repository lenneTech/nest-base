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

  /* Toggle switch */
  .feat-toggle {
    position: relative; width: 36px; height: 20px;
    display: inline-block; flex-shrink: 0;
  }
  .feat-toggle input {
    position: absolute; opacity: 0; width: 100%; height: 100%;
    margin: 0; cursor: pointer; z-index: 1;
  }
  .feat-toggle__track {
    position: absolute; inset: 0;
    background: var(--surface-3); border: 1px solid var(--line);
    border-radius: 999px; transition: background .2s var(--ease), border-color .2s var(--ease);
  }
  .feat-toggle__thumb {
    position: absolute; top: 2px; left: 2px;
    width: 14px; height: 14px; border-radius: 999px;
    background: var(--fg-faint);
    transition: transform .25s var(--ease), background .2s var(--ease);
  }
  .feat-toggle input:checked ~ .feat-toggle__track { background: var(--accent-soft); border-color: var(--line-accent); }
  .feat-toggle input:checked ~ .feat-toggle__thumb { background: var(--accent); transform: translateX(16px); box-shadow: 0 0 8px var(--accent-glow); }
  .feat-toggle input:disabled ~ .feat-toggle__track { opacity: .5; cursor: not-allowed; }
  .feat-toggle input:focus-visible ~ .feat-toggle__track { box-shadow: 0 0 0 3px var(--accent-soft); }

  /* Restart overlay */
  .feat-restart {
    position: fixed; inset: 0; background: rgba(0,0,0,.85);
    backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center;
    z-index: 1000; animation: fadeIn .2s ease-out;
  }
  .feat-restart.is-visible { display: flex; }
  .feat-restart__box {
    background: var(--surface-1); border: 1px solid var(--line-accent);
    border-radius: var(--radius); padding: 2rem 2.5rem;
    text-align: center; max-width: 380px;
    box-shadow: 0 0 40px var(--accent-glow);
  }
  .feat-restart__title { font-size: 1.1rem; font-weight: 600; color: var(--fg); margin: 0 0 .5rem; letter-spacing: -0.01em; }
  .feat-restart__msg { color: var(--fg-muted); font-size: .88rem; margin: 0 0 1rem; }
  .feat-restart__spinner {
    width: 32px; height: 32px; margin: 0 auto 1rem;
    border: 2px solid var(--surface-3); border-top-color: var(--accent);
    border-radius: 999px; animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
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
  <h3 class="feat-section__title">How toggling works</h3>
  <p class="admin-meta">
    Flipping a switch above writes the matching <code>FEATURE_*_ENABLED</code> line into <code>.env</code> and touches <code>src/main.ts</code> so <code>bun --watch</code> restarts the API.
    The page reloads automatically once the new process answers. Module imports and controller registration are driven entirely by these flags — see <code>src/core/features/features.ts</code> for the schema.
  </p>
</div>

<div class="feat-restart" id="feat-restart">
  <div class="feat-restart__box">
    <div class="feat-restart__spinner"></div>
    <h3 class="feat-restart__title">Restarting server…</h3>
    <p class="feat-restart__msg" id="feat-restart-msg">Applying feature change. The page will reload when the API is back.</p>
  </div>
</div>

<script>
(function() {
  const overlay = document.getElementById('feat-restart');
  const msg = document.getElementById('feat-restart-msg');
  document.querySelectorAll('input[data-toggle]').forEach((input) => {
    input.addEventListener('change', async (e) => {
      const el = e.target;
      const key = el.getAttribute('data-key');
      const enabled = el.checked;
      // Lock all toggles while one is in flight.
      document.querySelectorAll('input[data-toggle]').forEach((x) => { x.disabled = true; });
      try {
        const r = await fetch('/dev/features/' + encodeURIComponent(key) + '/toggle', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: enabled }),
        });
        if (!r.ok) {
          const t = await r.text();
          throw new Error('Toggle failed: ' + r.status + ' ' + t);
        }
      } catch (err) {
        document.querySelectorAll('input[data-toggle]').forEach((x) => { x.disabled = false; });
        el.checked = !enabled;
        if (msg) msg.textContent = String(err && err.message ? err.message : err);
        if (overlay) {
          overlay.classList.add('is-visible');
          setTimeout(() => overlay.classList.remove('is-visible'), 3000);
        }
        return;
      }
      // Show overlay + poll /health/live until the new process answers.
      if (overlay) overlay.classList.add('is-visible');
      const start = Date.now();
      const deadline = start + 30_000;
      const poll = async () => {
        try {
          // Tiny delay so the file-watcher can pick up the touch first.
          await new Promise((res) => setTimeout(res, 600));
          const h = await fetch('/health/live', { cache: 'no-store' });
          if (h.ok) {
            // Wait briefly so the new process has finished routing setup.
            await new Promise((res) => setTimeout(res, 200));
            window.location.reload();
            return;
          }
        } catch (_e) { /* expected during restart */ }
        if (Date.now() < deadline) setTimeout(poll, 500);
        else if (msg) msg.textContent = 'Restart took longer than expected. Reload manually.';
      };
      poll();
    });
  });
})();
</script>`;

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
      <label class="feat-toggle" title="Toggle ${escapeHtml(meta.label)}">
        <input type="checkbox" data-toggle data-key="${escapeHtml(meta.key)}" ${active ? "checked" : ""} />
        <span class="feat-toggle__track"></span>
        <span class="feat-toggle__thumb"></span>
      </label>
    </div>
    <p class="feat-card__desc">${escapeHtml(meta.description)}</p>
    <div class="feat-card__exposes">${exposes}</div>
    <div class="feat-card__env">
      <code>${escapeHtml(meta.envKey)}=${active ? "true" : "false"}</code>
      <span class="feat-card__env-state">${active ? "✓ enabled" : "set to ON to enable"}</span>
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
