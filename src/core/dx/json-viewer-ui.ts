import { renderAdminLayout } from "./admin-layout.js";

/**
 * Generic JSON viewer renderer.
 *
 * Server-renders the value as syntax-highlighted, collapsible HTML
 * (no client framework, ~1KB of inline JS for the toggle/copy/search
 * interactions). Used by /errors, /dev/postgrest-parse and any other
 * page that wants to surface structured data in the dev-hub theme
 * instead of dumping `application/json` to the browser.
 *
 * The renderer is pure — it stringifies the value once and walks the
 * resulting AST to emit highlighted spans. Cycles fall back to
 * "[Circular]". Functions, BigInts and Symbols are rendered as
 * descriptive text rather than throwing.
 */

export interface JsonViewerInput {
  /** Page <title> + heading. */
  title: string;
  /** Optional subtitle under the heading. */
  subtitle?: string;
  /** Active sidebar nav id. */
  currentNav: string;
  /** Optional extra HTML rendered above the viewer (e.g. action bar). */
  prelude?: string;
  /** Value to render. Anything JSON-stringifiable. */
  value: unknown;
  /** Optional `?source=…` link rendered as the .json sibling endpoint. */
  rawJsonHref?: string;
}

export function renderJsonViewerPage(input: JsonViewerInput): string {
  const valueHtml = renderValue(input.value, 0);
  const rawJson = stableStringify(input.value);
  const body = `
${VIEWER_STYLES}
${input.prelude ?? ""}
<div class="admin-card">
  <div class="jv-toolbar">
    <input type="search" id="jv-filter" class="jv-search" placeholder="Filter keys (highlights matches)…" autocomplete="off">
    <div class="jv-actions">
      <button type="button" class="jv-btn" data-jv-action="expand-all">Expand all</button>
      <button type="button" class="jv-btn" data-jv-action="collapse-all">Collapse all</button>
      <button type="button" class="jv-btn jv-btn--accent" data-jv-action="copy" data-jv-payload="${escapeAttr(rawJson)}">Copy JSON</button>
      ${input.rawJsonHref ? `<a class="jv-btn" href="${escapeAttr(input.rawJsonHref)}" target="_blank" rel="noopener">Raw .json ↗</a>` : ""}
    </div>
  </div>
  <pre class="jv"><code class="jv__root">${valueHtml}</code></pre>
</div>
${VIEWER_SCRIPT}
`;
  return renderAdminLayout({
    title: input.title,
    ...(input.subtitle ? { subtitle: input.subtitle } : {}),
    currentNav: input.currentNav,
    body,
  });
}

const VIEWER_STYLES = `
<style>
  .jv-toolbar {
    display: flex; gap: .85rem; align-items: center;
    margin-bottom: 1rem; flex-wrap: wrap;
  }
  .jv-search {
    flex: 1; min-width: 220px;
    background: var(--surface-2); border: 1px solid var(--line);
    border-radius: var(--radius-sm); padding: .55rem .85rem;
    color: var(--fg); font-family: inherit; font-size: .85rem;
    transition: border-color .15s, box-shadow .15s;
  }
  .jv-search::placeholder { color: var(--fg-faint); }
  .jv-search:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .jv-actions { display: flex; gap: .5rem; }
  .jv-btn {
    background: var(--surface-2); border: 1px solid var(--line);
    color: var(--fg-muted); padding: .5rem .9rem; border-radius: var(--radius-sm);
    font-family: inherit; font-size: .8rem; font-weight: 500;
    cursor: pointer; transition: all .15s var(--ease);
  }
  .jv-btn:hover { background: var(--surface-3); border-color: var(--line-strong); color: var(--fg); }
  .jv-btn--accent { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
  .jv-btn--accent:hover { filter: brightness(1.05); color: var(--accent-ink); transform: translateY(-1px); box-shadow: 0 4px 16px var(--accent-glow); }

  .jv {
    background: var(--surface-1); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 1.25rem 1.5rem; margin: 0;
    overflow: auto; font-family: var(--font-mono); font-size: .82rem;
    line-height: 1.65; max-height: 70vh;
  }
  .jv code { font-family: inherit; background: transparent; padding: 0; color: inherit; border: 0; }

  .jv__indent { display: inline-block; width: 1.5em; }
  .jv__toggle {
    display: inline-block; width: 1em; cursor: pointer; user-select: none;
    color: var(--fg-faint); transition: transform .15s, color .15s;
  }
  .jv__toggle:hover { color: var(--accent); }
  .jv__toggle--collapsed::before { content: "▸"; }
  .jv__toggle--expanded::before { content: "▾"; }
  .jv__children { display: block; }
  .jv__node[data-collapsed="true"] > .jv__children { display: none; }
  .jv__node[data-collapsed="true"] > .jv__summary::after {
    content: " /* " attr(data-count) " items */";
    color: var(--fg-faint); font-style: italic;
  }

  .jv__key { color: var(--accent); }
  .jv__key--match { background: var(--accent-soft); padding: 0 .15em; border-radius: 2px; outline: 1px solid var(--line-accent); }
  .jv__string { color: #d8b4fe; }
  .jv__number { color: #93c5fd; }
  .jv__boolean { color: #fbbf24; font-weight: 600; }
  .jv__null { color: var(--fg-faint); font-style: italic; }
  .jv__brace { color: var(--fg-muted); }
  .jv__comma { color: var(--fg-faint); }
  .jv__special { color: var(--err); font-style: italic; }

  .jv__copied {
    position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 100;
    background: var(--surface-2); color: var(--accent);
    padding: .65rem 1rem; border-radius: var(--radius-sm);
    border: 1px solid var(--line-accent); font-size: .8rem; font-weight: 500;
    opacity: 0; transform: translateY(8px); transition: all .25s var(--ease);
    pointer-events: none;
  }
  .jv__copied.is-visible { opacity: 1; transform: translateY(0); }
</style>
`;

const VIEWER_SCRIPT = `
<div class="jv__copied" id="jv-copied">✓ Copied to clipboard</div>
<script>
(function() {
  const root = document.querySelector('.jv__root');
  if (!root) return;
  // Toggle expand/collapse
  root.addEventListener('click', (e) => {
    const t = e.target.closest('.jv__toggle');
    if (!t) return;
    const node = t.closest('.jv__node');
    if (!node) return;
    const collapsed = node.getAttribute('data-collapsed') === 'true';
    node.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
    t.classList.toggle('jv__toggle--collapsed', !collapsed);
    t.classList.toggle('jv__toggle--expanded', collapsed);
  });
  // Expand/collapse all + copy
  document.querySelectorAll('[data-jv-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-jv-action');
      if (action === 'expand-all') {
        root.querySelectorAll('.jv__node').forEach((n) => {
          n.setAttribute('data-collapsed', 'false');
          const t = n.querySelector(':scope > .jv__summary > .jv__toggle');
          if (t) { t.classList.add('jv__toggle--expanded'); t.classList.remove('jv__toggle--collapsed'); }
        });
      } else if (action === 'collapse-all') {
        root.querySelectorAll('.jv__node').forEach((n) => {
          n.setAttribute('data-collapsed', 'true');
          const t = n.querySelector(':scope > .jv__summary > .jv__toggle');
          if (t) { t.classList.add('jv__toggle--collapsed'); t.classList.remove('jv__toggle--expanded'); }
        });
      } else if (action === 'copy') {
        const payload = btn.getAttribute('data-jv-payload') || '';
        navigator.clipboard.writeText(payload).then(() => {
          const toast = document.getElementById('jv-copied');
          if (toast) {
            toast.classList.add('is-visible');
            setTimeout(() => toast.classList.remove('is-visible'), 1400);
          }
        }).catch(() => { /* clipboard API may be blocked, ignore */ });
      }
    });
  });
  // Search filter — highlights matching keys, expands their parents
  const search = document.getElementById('jv-filter');
  if (search) {
    let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => applyFilter(search.value.trim().toLowerCase()), 80);
    });
  }
  function applyFilter(needle) {
    root.querySelectorAll('.jv__key--match').forEach((el) => el.classList.remove('jv__key--match'));
    if (!needle) return;
    root.querySelectorAll('.jv__key').forEach((el) => {
      if (el.textContent.toLowerCase().includes(needle)) {
        el.classList.add('jv__key--match');
        // Expand all ancestors
        let n = el.closest('.jv__node');
        while (n) {
          n.setAttribute('data-collapsed', 'false');
          const t = n.querySelector(':scope > .jv__summary > .jv__toggle');
          if (t) { t.classList.add('jv__toggle--expanded'); t.classList.remove('jv__toggle--collapsed'); }
          n = n.parentElement?.closest('.jv__node');
        }
      }
    });
  }
})();
</script>
`;

/** Pure server-side rendering of a value to highlighted HTML. */
export function renderValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object> = new WeakSet(),
): string {
  if (value === null) return `<span class="jv__null">null</span>`;
  if (value === undefined) return `<span class="jv__special">undefined</span>`;
  switch (typeof value) {
    case "string":
      return `<span class="jv__string">${escapeHtml(JSON.stringify(value))}</span>`;
    case "number":
      return `<span class="jv__number">${escapeHtml(String(value))}</span>`;
    case "boolean":
      return `<span class="jv__boolean">${value}</span>`;
    case "bigint":
      return `<span class="jv__number">${escapeHtml(String(value))}n</span>`;
    case "symbol":
      return `<span class="jv__special">${escapeHtml(String(value))}</span>`;
    case "function":
      return `<span class="jv__special">[Function]</span>`;
    case "object":
      break;
    default:
      return `<span class="jv__special">${escapeHtml(String(value))}</span>`;
  }
  // Array/object — guard against cycles.
  if (seen.has(value as object)) {
    return `<span class="jv__special">[Circular]</span>`;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `<span class="jv__brace">[]</span>`;
    }
    const items = value
      .map((item, idx) => {
        const last = idx === value.length - 1;
        return `<span class="jv__indent"></span>${renderValue(item, depth + 1, seen)}${last ? "" : '<span class="jv__comma">,</span>'}`;
      })
      .join("\n");
    return (
      `<span class="jv__node" data-collapsed="false" data-count="${value.length} items">` +
      `<span class="jv__summary"><span class="jv__toggle jv__toggle--expanded"></span><span class="jv__brace">[</span></span>` +
      `<span class="jv__children">\n${items}\n</span>` +
      `<span class="jv__brace">]</span>` +
      `</span>`
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return `<span class="jv__brace">{}</span>`;
  }
  const collapsed = depth >= 3 ? "true" : "false";
  const toggleCls = depth >= 3 ? "jv__toggle--collapsed" : "jv__toggle--expanded";
  const items = entries
    .map(([k, v], idx) => {
      const last = idx === entries.length - 1;
      const keyHtml = `<span class="jv__key">${escapeHtml(JSON.stringify(k))}</span>`;
      return `<span class="jv__indent"></span>${keyHtml}<span class="jv__comma">: </span>${renderValue(v, depth + 1, seen)}${last ? "" : '<span class="jv__comma">,</span>'}`;
    })
    .join("\n");
  return (
    `<span class="jv__node" data-collapsed="${collapsed}" data-count="${entries.length} keys">` +
    `<span class="jv__summary"><span class="jv__toggle ${toggleCls}"></span><span class="jv__brace">{</span></span>` +
    `<span class="jv__children">\n${items}\n</span>` +
    `<span class="jv__brace">}</span>` +
    `</span>`
  );
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "<<unserializable>>";
  }
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
