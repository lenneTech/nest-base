/**
 * Admin/DevHub layout planner.
 *
 * Pure function that wraps a page-specific HTML body in a shared
 * dark-mode shell — top bar with project label, sidebar with dev-tool
 * navigation, content slot, footer with quick links. The wrapper is
 * reused by `/dev` and every `/admin/*` renderer so the developer UIs
 * feel like one cohesive surface instead of disjointed pages.
 *
 * Inputs are explicit: the caller chooses the active nav item (so the
 * sidebar can highlight it) and supplies the already-rendered body
 * HTML. The body is trusted (it comes from another renderer in this
 * folder, all of which HTML-escape user-controlled values themselves).
 * The layout itself never inserts user input.
 */

export interface AdminNavItem {
  /** Stable identifier — matched against `currentNav` for highlighting. */
  id: string;
  /** Display label. */
  label: string;
  /** Target URL. */
  href: string;
  /** SVG icon markup (already trusted, no escaping). */
  icon: string;
}

export interface AdminNavSection {
  title: string;
  items: AdminNavItem[];
}

export interface AdminLayoutInput {
  /** Page <title> + heading. */
  title: string;
  /** Optional subtitle under the heading. */
  subtitle?: string;
  /** Active navigation entry (e.g. "dev-hub", "permissions"). */
  currentNav: string;
  /** Already-rendered, trusted body HTML. */
  body: string;
}

/**
 * Default sidebar layout — covers every dev-tool surface this repo
 * ships. The icon set is small, single-color, fits 16px square; we
 * inline them to avoid an external icon dependency.
 */
export function defaultAdminNav(): AdminNavSection[] {
  return [
    {
      title: "Übersicht",
      items: [
        { id: "dev-hub", label: "Dev Hub", href: "/dev", icon: ICON_HOME },
        { id: "diagnostics", label: "Diagnostics", href: "/dev/diagnostics", icon: ICON_HEART },
        { id: "features", label: "Features", href: "/dev/features", icon: ICON_TOGGLE },
      ],
    },
    {
      title: "API & Docs",
      items: [
        { id: "scalar", label: "API Reference", href: "/api/docs", icon: ICON_BOOK },
        { id: "openapi", label: "OpenAPI Spec", href: "/api/openapi.json", icon: ICON_FILE },
        { id: "errors", label: "Error Codes", href: "/errors", icon: ICON_BUG },
        {
          id: "prisma-studio",
          label: "Prisma Studio",
          href: "http://localhost:5555",
          icon: ICON_DATABASE,
        },
      ],
    },
    {
      title: "Admin",
      items: [
        {
          id: "permissions",
          label: "Permission Tester",
          href: "/admin/permissions/test",
          icon: ICON_SHIELD,
        },
        {
          id: "webhooks",
          label: "Webhook Inspector",
          href: "/admin/webhooks",
          icon: ICON_WEBHOOK,
        },
        {
          id: "realtime",
          label: "Realtime Inspector",
          href: "/admin/realtime",
          icon: ICON_RADIO,
        },
        { id: "audit", label: "Audit Browser", href: "/admin/audit", icon: ICON_LIST },
        { id: "search", label: "Search Tester", href: "/admin/search", icon: ICON_SEARCH },
      ],
    },
  ];
}

export function renderAdminLayout(input: AdminLayoutInput): string {
  const sections = defaultAdminNav();
  const sidebar = sections
    .map((section) => {
      const items = section.items
        .map((item) => {
          const active = item.id === input.currentNav ? " admin-nav__link--active" : "";
          return `<a class="admin-nav__link${active}" href="${item.href}"><span class="admin-nav__icon">${item.icon}</span><span>${item.label}</span></a>`;
        })
        .join("\n");
      return `<div class="admin-nav__section"><h3 class="admin-nav__title">${section.title}</h3>${items}</div>`;
    })
    .join("\n");

  const subtitle = input.subtitle ? `<p class="admin-page__subtitle">${input.subtitle}</p>` : "";

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${input.title} — nest-server-template</title>
<style>${ADMIN_LAYOUT_CSS}</style>
</head>
<body>
<aside class="admin-sidebar">
  <div class="admin-brand">
    <span class="admin-brand__logo">⬢</span>
    <div class="admin-brand__text">
      <span class="admin-brand__name">nest-server</span>
      <span class="admin-brand__env">development</span>
    </div>
  </div>
  <nav class="admin-nav">
${sidebar}
  </nav>
  <div class="admin-sidebar__footer">
    <a href="https://github.com/nestjs/nest" target="_blank" rel="noopener">NestJS Docs ↗</a>
  </div>
</aside>
<main class="admin-main">
  <header class="admin-header">
    <div>
      <h1 class="admin-page__title">${input.title}</h1>
      ${subtitle}
    </div>
    <div class="admin-header__meta">
      <span class="admin-badge admin-badge--ok">● online</span>
    </div>
  </header>
  <section class="admin-content">
${input.body}
  </section>
</main>
</body>
</html>`;
}

/** Compact, dark-mode CSS for every dev/admin surface. */
const ADMIN_LAYOUT_CSS = `
:root {
  --bg: #0a0e14;
  --bg-elevated: #11161f;
  --bg-elevated-2: #1a212d;
  --border: #232b39;
  --border-strong: #344155;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --text-dim: #6b7280;
  --primary: #58a6ff;
  --primary-bg: #1f3a5f;
  --success: #3fb950;
  --warning: #d29922;
  --danger: #f85149;
  --code-bg: #0d1117;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.5; }
body { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre { font-family: ui-monospace, SF Mono, Consolas, monospace; font-size: .85em; }
pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 1rem; overflow: auto; }

.admin-sidebar { background: var(--bg-elevated); border-right: 1px solid var(--border); padding: 1.25rem 0; display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
.admin-brand { display: flex; align-items: center; gap: .75rem; padding: 0 1.25rem 1.25rem; border-bottom: 1px solid var(--border); margin-bottom: 1rem; }
.admin-brand__logo { font-size: 1.5rem; color: var(--primary); }
.admin-brand__text { display: flex; flex-direction: column; }
.admin-brand__name { font-weight: 600; }
.admin-brand__env { font-size: .7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; }

.admin-nav { flex: 1; }
.admin-nav__section { padding: .5rem 1rem; }
.admin-nav__title { font-size: .7rem; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: .08em; margin: .75rem .25rem .5rem; }
.admin-nav__link { display: flex; align-items: center; gap: .6rem; padding: .45rem .65rem; border-radius: 6px; color: var(--text-muted); transition: background .12s, color .12s; font-weight: 500; }
.admin-nav__link:hover { background: var(--bg-elevated-2); color: var(--text); text-decoration: none; }
.admin-nav__link--active { background: var(--primary-bg); color: var(--text); }
.admin-nav__link--active .admin-nav__icon { color: var(--primary); }
.admin-nav__icon { display: inline-flex; width: 16px; height: 16px; flex-shrink: 0; }
.admin-nav__icon svg { width: 100%; height: 100%; stroke: currentColor; stroke-width: 2; fill: none; }

.admin-sidebar__footer { padding: 1rem 1.25rem; border-top: 1px solid var(--border); font-size: .8rem; color: var(--text-muted); }

.admin-main { padding: 2rem 2.5rem; max-width: 1280px; }
.admin-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 1.25rem; border-bottom: 1px solid var(--border); margin-bottom: 1.75rem; }
.admin-page__title { font-size: 1.65rem; font-weight: 600; margin: 0; }
.admin-page__subtitle { color: var(--text-muted); margin: .35rem 0 0; }
.admin-badge { display: inline-flex; padding: .25rem .65rem; border-radius: 999px; font-size: .75rem; font-weight: 500; background: var(--bg-elevated-2); color: var(--text-muted); }
.admin-badge--ok { color: var(--success); }
.admin-badge--warn { color: var(--warning); }
.admin-badge--err { color: var(--danger); }

.admin-card { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
.admin-card__title { font-size: 1rem; font-weight: 600; margin: 0 0 .85rem; color: var(--text); }
.admin-grid { display: grid; gap: 1.25rem; }
.admin-grid--2 { grid-template-columns: repeat(2, 1fr); }
.admin-grid--3 { grid-template-columns: repeat(3, 1fr); }

form.admin-form { display: grid; gap: .85rem; }
form.admin-form .row { display: grid; grid-template-columns: 1fr 1fr auto; gap: .85rem; align-items: end; }
form.admin-form label { display: flex; flex-direction: column; gap: .35rem; font-size: .8rem; color: var(--text-muted); font-weight: 500; }
form.admin-form input, form.admin-form select, form.admin-form textarea { background: var(--bg); border: 1px solid var(--border-strong); border-radius: 6px; padding: .55rem .7rem; color: var(--text); font-family: inherit; font-size: .9rem; transition: border-color .12s; }
form.admin-form input:focus, form.admin-form select:focus, form.admin-form textarea:focus { outline: none; border-color: var(--primary); }
form.admin-form button { background: var(--primary); color: #08111d; border: 0; border-radius: 6px; padding: .6rem 1.25rem; font-weight: 600; font-size: .9rem; cursor: pointer; transition: filter .12s; }
form.admin-form button:hover { filter: brightness(1.15); }

.admin-table { width: 100%; border-collapse: collapse; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.admin-table th, .admin-table td { padding: .7rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
.admin-table th { background: var(--bg-elevated-2); font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); font-weight: 600; }
.admin-table tr:last-child td { border-bottom: 0; }
.admin-table tr[data-superset="true"] { background: rgba(210, 153, 34, .12); }
.admin-table tr:hover td { background: var(--bg-elevated-2); }

.admin-empty { padding: 2.5rem 1.5rem; text-align: center; color: var(--text-muted); background: var(--bg-elevated); border: 1px dashed var(--border-strong); border-radius: 8px; }
.admin-meta { color: var(--text-muted); margin-bottom: 1rem; }
.admin-meta strong { color: var(--text); font-weight: 600; }
.admin-link-list { list-style: none; padding: 0; margin: 0; display: grid; gap: .35rem; }
.admin-link-list a { display: flex; align-items: center; gap: .5rem; padding: .55rem .75rem; border-radius: 6px; color: var(--text); background: var(--bg-elevated-2); transition: background .12s; }
.admin-link-list a:hover { background: var(--border); text-decoration: none; }

@media (max-width: 768px) {
  body { grid-template-columns: 1fr; }
  .admin-sidebar { position: static; height: auto; }
  .admin-main { padding: 1.5rem; }
}
`;

const ICON_HOME = `<svg viewBox="0 0 24 24"><path d="M3 12l9-9 9 9"/><path d="M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10"/></svg>`;
const ICON_HEART = `<svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`;
const ICON_TOGGLE = `<svg viewBox="0 0 24 24"><rect x="1" y="6" width="22" height="12" rx="6"/><circle cx="16" cy="12" r="3"/></svg>`;
const ICON_BOOK = `<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>`;
const ICON_FILE = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>`;
const ICON_BUG = `<svg viewBox="0 0 24 24"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 6V3M9 8L7 6M15 8l2-2M5 12H3M21 12h-2M5 18l-2 1M21 18l-2 1"/></svg>`;
const ICON_SHIELD = `<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const ICON_WEBHOOK = `<svg viewBox="0 0 24 24"><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 117.5 12.5"/><path d="M16.5 17l-3.4-6.34a4 4 0 00-7.1.84"/><path d="M14.5 8a4 4 0 016.84-2.41"/></svg>`;
const ICON_RADIO = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 010 8.49M7.76 16.24a6 6 0 010-8.49M20.49 3.51a12 12 0 010 16.97M3.51 20.49a12 12 0 010-16.97"/></svg>`;
const ICON_LIST = `<svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>`;
const ICON_SEARCH = `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
const ICON_DATABASE = `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/></svg>`;
