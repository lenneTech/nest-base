import { renderAdminLayout } from "./admin-layout.js";
import type { ErdPlan } from "./erd-builder.js";

/**
 * `/dev/erd` HTML page — Mermaid-rendered Prisma ERD.
 *
 * Mermaid is loaded from the unpkg CDN. The CSP in dev allows
 * `cdn.jsdelivr.net` and unpkg via `script-src` (see
 * `security-headers.ts`); the route 404s outside development so this
 * never loads in production.
 */
export function renderErdPage(plan: ErdPlan): string {
  const summaryNote =
    plan.modelCount === 0
      ? `<em>No models found in <code>prisma/schema.prisma</code>. Did you run <code>bun run prepare:schema</code>?</em>`
      : `${plan.modelCount} model(s), ${plan.relationCount} relation(s).`;

  // The Mermaid source is escaped into a textarea so the browser
  // never tries to parse it before Mermaid takes over.
  const escapedSource = escapeHtml(plan.mermaid);

  const body = `
<style>
  .erd-card { background: var(--surface-1); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.5rem; }
  .erd-toolbar { display: flex; gap: .5rem; margin-bottom: 1rem; }
  .erd-toolbar button {
    background: var(--surface-2); color: var(--fg); border: 1px solid var(--line);
    padding: .35rem .85rem; border-radius: 6px; font-size: .8rem; cursor: pointer;
  }
  .erd-toolbar button:hover { background: var(--surface-3); border-color: var(--line-accent); }
  .erd-source { width: 100%; min-height: 12rem; background: var(--surface-2); color: var(--fg);
    border: 1px solid var(--line); border-radius: 6px; padding: .75rem; font-family: var(--font-mono);
    font-size: .8rem; resize: vertical; }
  .erd-canvas { background: var(--surface-2); border: 1px solid var(--line); border-radius: 6px; padding: 1rem; min-height: 18rem; overflow: auto; }
  .erd-canvas svg { max-width: 100%; height: auto; }
</style>

<div class="erd-card">
  <div class="erd-toolbar">
    <button id="erd-toggle-source" type="button">Show source</button>
    <button id="erd-copy-source" type="button">Copy Mermaid</button>
  </div>
  <textarea id="erd-source" class="erd-source" hidden readonly>${escapedSource}</textarea>
  <div class="erd-canvas" id="erd-canvas"><pre class="mermaid">${escapedSource}</pre></div>
</div>

<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({
    startOnLoad: true,
    theme: 'dark',
    themeVariables: { fontFamily: 'monospace', fontSize: '13px' },
  });

  document.getElementById('erd-toggle-source')?.addEventListener('click', () => {
    const ta = document.getElementById('erd-source');
    if (ta) ta.hidden = !ta.hidden;
  });
  document.getElementById('erd-copy-source')?.addEventListener('click', () => {
    const ta = document.getElementById('erd-source');
    if (!ta) return;
    navigator.clipboard?.writeText(ta.value);
  });
</script>
`;

  return renderAdminLayout({
    title: "ERD",
    subtitle: `Live Prisma schema diagram. ${summaryNote}`,
    currentNav: "erd",
    body,
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
