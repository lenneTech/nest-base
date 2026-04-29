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
        { id: "coverage", label: "Coverage", href: "/dev/coverage", icon: ICON_CHART },
        { id: "tests", label: "Tests", href: "/dev/tests", icon: ICON_CHECK },
        { id: "logs", label: "Logs", href: "/dev/logs", icon: ICON_TERMINAL },
      ],
    },
    {
      title: "API & Docs",
      items: [
        { id: "scalar", label: "API Reference", href: "/api/docs", icon: ICON_BOOK },
        { id: "openapi", label: "OpenAPI Spec", href: "/api/openapi", icon: ICON_FILE },
        { id: "errors", label: "Error Codes", href: "/errors", icon: ICON_BUG },
        {
          id: "nest-devtools",
          label: "NestJS DevTools",
          href: "/dev/devtools",
          icon: ICON_GRAPH,
        },
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
          return `<a class="admin-nav__link${active}" href="${item.href}"><span class="admin-nav__icon">${item.icon}</span><span class="admin-nav__label">${item.label}</span></a>`;
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
<title>${input.title} — nest-server</title>
<link rel="preconnect" href="https://rsms.me/">
<link rel="stylesheet" href="https://rsms.me/inter/inter.css">
<style>${ADMIN_LAYOUT_CSS}</style>
</head>
<body>
<div class="admin-shell">
<aside class="admin-sidebar">
  <a class="admin-brand" href="/dev">
    <span class="admin-brand__logo" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="22" height="22" fill="none">
        <path d="M16 3l11 6.5v13L16 29 5 22.5v-13L16 3z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        <path d="M16 3v26M5 9.5l22 13M27 9.5l-22 13" stroke="currentColor" stroke-width="1" opacity="0.4"/>
      </svg>
    </span>
    <div class="admin-brand__text">
      <span class="admin-brand__name">nest-server</span>
      <span class="admin-brand__env"><span class="admin-brand__dot"></span>development</span>
    </div>
  </a>
  <nav class="admin-nav">
${sidebar}
  </nav>
  <div class="admin-sidebar__footer">
    <a href="https://docs.nestjs.com" target="_blank" rel="noopener" class="admin-sidebar__doclink">
      <span>NestJS Docs</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>
    </a>
  </div>
</aside>
<main class="admin-main">
  <header class="admin-header">
    <div>
      <h1 class="admin-page__title">${input.title}</h1>
      ${subtitle}
    </div>
    <div class="admin-header__meta">
      <span class="admin-badge admin-badge--ok"><span class="admin-badge__dot"></span>online</span>
    </div>
  </header>
  <section class="admin-content">
${input.body}
  </section>
</main>
</div>
</body>
</html>`;
}

/** Premium dark UI for every dev/admin surface. Near-black + electric-lime. */
const ADMIN_LAYOUT_CSS = `
:root {
  /* Surfaces — near-black instead of pure #000 to avoid OLED smear */
  --bg: #020203;
  --surface-1: #06070a;
  --surface-2: #0c0d11;
  --surface-3: #14161b;
  --surface-hover: #1c1f25;

  /* Borders — barely visible, get clearer on hover */
  --line: rgba(255, 255, 255, 0.06);
  --line-strong: rgba(255, 255, 255, 0.12);
  --line-accent: rgba(197, 251, 69, 0.45);

  /* Type scale — high-contrast hierarchy */
  --fg: #ffffff;
  --fg-muted: #a1a1aa;
  --fg-dim: #71717a;
  --fg-faint: #52525b;

  /* The accent — electric lime */
  --accent: #c5fb45;
  --accent-soft: rgba(197, 251, 69, 0.12);
  --accent-glow: rgba(197, 251, 69, 0.35);
  --accent-ink: #0a0a0a;

  /* Status semantics */
  --ok: #4ade80;
  --warn: #fbbf24;
  --err: #f87171;

  --radius: 14px;
  --radius-sm: 8px;
  --radius-lg: 18px;

  --shadow-soft: 0 0 0 1px var(--line), 0 1px 2px rgba(0,0,0,.4);
  --shadow-lift: 0 0 0 1px var(--line-strong), 0 12px 32px rgba(0,0,0,.6);
  --shadow-glow: 0 0 0 1px var(--line-accent), 0 0 32px var(--accent-soft);

  /* Premium easing — Linear/Vercel/Apple feel */
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);

  --font-sans: "Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", "Fira Code", Consolas, monospace;
}

* { box-sizing: border-box; }
html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
html, body {
  margin: 0; padding: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: 14px; line-height: 1.5;
  font-feature-settings: "ss01", "cv11";
  letter-spacing: -0.005em;
}
/* Tabular figures everywhere a number is shown — prevents column shift */
.cov-tile__value, .test-tile__value, .status-card__meta, .admin-table td:not(:first-child),
.cov-pct, .log-table { font-variant-numeric: tabular-nums; }
body::before {
  /* very subtle ambient glow at the top-right corner */
  content: ""; position: fixed; pointer-events: none;
  top: -300px; right: -300px; width: 800px; height: 800px;
  background: radial-gradient(circle, var(--accent-soft) 0%, transparent 60%);
  opacity: 0.5; z-index: 0;
}
.admin-shell { position: relative; z-index: 1; display: grid; grid-template-columns: 256px 1fr; min-height: 100vh; }
a { color: var(--accent); text-decoration: none; transition: color .15s; }
a:hover { color: var(--fg); }
code, pre { font-family: var(--font-mono); font-size: .85em; }
pre {
  background: var(--surface-1); border: 1px solid var(--line);
  border-radius: var(--radius-sm); padding: 1rem;
  overflow: auto; line-height: 1.6;
}
::selection { background: var(--accent); color: var(--accent-ink); }

/* ── Sidebar ─────────────────────────────────────────────── */
.admin-sidebar {
  background: var(--surface-1);
  border-right: 1px solid var(--line);
  padding: 1.5rem 0 1rem;
  display: flex; flex-direction: column;
  position: sticky; top: 0; height: 100vh;
  overflow-y: auto;
}
.admin-sidebar::-webkit-scrollbar { width: 6px; }
.admin-sidebar::-webkit-scrollbar-thumb { background: var(--surface-3); border-radius: 999px; }

.admin-brand {
  display: flex; align-items: center; gap: .75rem;
  padding: 0 1.5rem 1.25rem;
  margin: 0 0 1rem;
  border-bottom: 1px solid var(--line);
  color: var(--fg);
  transition: opacity .15s;
}
.admin-brand:hover { opacity: .85; color: var(--fg); }
.admin-brand__logo {
  display: grid; place-items: center;
  width: 36px; height: 36px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-ink);
  flex-shrink: 0;
  box-shadow: 0 0 20px var(--accent-glow);
}
.admin-brand__text { display: flex; flex-direction: column; gap: .15rem; }
.admin-brand__name {
  font-weight: 600; font-size: .95rem;
  letter-spacing: -0.01em;
}
.admin-brand__env {
  display: inline-flex; align-items: center; gap: .35rem;
  font-size: .68rem; color: var(--fg-dim);
  text-transform: uppercase; letter-spacing: .12em; font-weight: 500;
}
.admin-brand__dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: var(--accent); box-shadow: 0 0 6px var(--accent);
  animation: pulse 2s ease-in-out infinite;
}

.admin-nav { flex: 1; padding: 0 .75rem; }
.admin-nav__section { padding: .25rem 0 1rem; }
.admin-nav__title {
  font-size: .65rem; font-weight: 600; color: var(--fg-faint);
  text-transform: uppercase; letter-spacing: .14em;
  margin: .5rem .85rem .5rem;
}
.admin-nav__link {
  display: flex; align-items: center; gap: .7rem;
  padding: .55rem .85rem;
  border-radius: var(--radius-sm);
  color: var(--fg-muted);
  font-weight: 500; font-size: .875rem;
  position: relative;
  transition: background .15s ease, color .15s ease;
}
.admin-nav__link:hover {
  background: var(--surface-2);
  color: var(--fg);
}
.admin-nav__link--active {
  color: var(--fg);
  background: var(--surface-2);
}
.admin-nav__link--active::before {
  content: ""; position: absolute;
  left: -.75rem; top: 25%; bottom: 25%;
  width: 3px; border-radius: 0 3px 3px 0;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
}
.admin-nav__link--active .admin-nav__icon { color: var(--accent); }
.admin-nav__icon { display: inline-flex; width: 16px; height: 16px; flex-shrink: 0; color: var(--fg-dim); transition: color .15s; }
.admin-nav__icon svg { width: 100%; height: 100%; stroke: currentColor; stroke-width: 1.75; fill: none; }
.admin-nav__link:hover .admin-nav__icon { color: var(--fg); }
.admin-nav__label { letter-spacing: -0.005em; }

.admin-sidebar__footer { padding: 1rem 1.5rem 0; border-top: 1px solid var(--line); margin: 0 .75rem; }
.admin-sidebar__doclink {
  display: inline-flex; align-items: center; gap: .35rem;
  font-size: .78rem; color: var(--fg-dim);
}
.admin-sidebar__doclink:hover { color: var(--fg); }

/* ── Main ─────────────────────────────────────────────── */
.admin-main {
  padding: 2rem 2.5rem 4rem;
  max-width: 1320px;
  width: 100%;
}
.admin-header {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--line);
  margin-bottom: 2rem;
}
.admin-page__title {
  font-size: 1.85rem; font-weight: 600; margin: 0;
  letter-spacing: -0.025em; color: var(--fg);
}
.admin-page__subtitle {
  color: var(--fg-muted); margin: .5rem 0 0;
  font-size: .92rem; max-width: 60ch;
}
.admin-badge {
  display: inline-flex; align-items: center; gap: .4rem;
  padding: .35rem .8rem;
  border-radius: 999px;
  font-size: .72rem; font-weight: 500;
  background: var(--surface-2); border: 1px solid var(--line);
  color: var(--fg-muted);
  letter-spacing: .04em;
}
.admin-badge__dot {
  width: 6px; height: 6px; border-radius: 999px; background: currentColor;
  box-shadow: 0 0 6px currentColor;
}
.admin-badge--ok { color: var(--ok); }
.admin-badge--ok .admin-badge__dot { animation: pulse 2s ease-in-out infinite; }
.admin-badge--warn { color: var(--warn); }
.admin-badge--err { color: var(--err); }

/* ── Cards ─────────────────────────────────────────────── */
.admin-card {
  background: var(--surface-1);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1.75rem 2rem;
  margin-bottom: 1.25rem;
  transition: border-color .25s var(--ease), transform .25s var(--ease), box-shadow .25s var(--ease);
}
.admin-card:hover { border-color: var(--line-strong); }
.admin-card--accent { border-color: var(--line-accent); }
.admin-card--accent:hover { box-shadow: var(--shadow-glow); }
.admin-card__title {
  font-size: .98rem; font-weight: 600; margin: 0 0 1.15rem;
  color: var(--fg); letter-spacing: -0.005em;
  display: flex; align-items: center; gap: .65rem; flex-wrap: wrap;
}
.admin-grid { display: grid; gap: 1.25rem; }
.admin-grid--2 { grid-template-columns: repeat(2, 1fr); }
.admin-grid--3 { grid-template-columns: repeat(3, 1fr); }

/* ── Forms ─────────────────────────────────────────────── */
form.admin-form { display: grid; gap: .9rem; }
form.admin-form .row { display: grid; grid-template-columns: 1fr 1fr auto; gap: .9rem; align-items: end; }
form.admin-form label {
  display: flex; flex-direction: column; gap: .4rem;
  font-size: .72rem; color: var(--fg-dim);
  text-transform: uppercase; letter-spacing: .08em; font-weight: 600;
}
form.admin-form input, form.admin-form select, form.admin-form textarea {
  background: var(--surface-2); border: 1px solid var(--line);
  border-radius: var(--radius-sm); padding: .65rem .85rem;
  color: var(--fg); font-family: inherit; font-size: .9rem;
  transition: border-color .15s, box-shadow .15s;
}
form.admin-form input:focus, form.admin-form select:focus, form.admin-form textarea:focus {
  outline: none; border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
form.admin-form input::placeholder, form.admin-form textarea::placeholder { color: var(--fg-faint); }
form.admin-form button {
  background: var(--accent); color: var(--accent-ink);
  border: 0; border-radius: var(--radius-sm);
  padding: .7rem 1.5rem;
  font-weight: 600; font-size: .88rem;
  font-family: inherit; cursor: pointer;
  transition: transform .12s ease, box-shadow .12s ease, filter .12s;
  letter-spacing: .01em;
}
form.admin-form button:hover {
  filter: brightness(1.05); transform: translateY(-1px);
  box-shadow: 0 4px 16px var(--accent-glow);
}
form.admin-form button:active { transform: translateY(0); }

/* ── Tables ─────────────────────────────────────────────── */
.admin-table {
  width: 100%; border-collapse: collapse;
  background: var(--surface-1);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  font-size: .88rem;
}
.admin-table th {
  background: var(--surface-2);
  font-size: .68rem; text-transform: uppercase; letter-spacing: .1em;
  color: var(--fg-dim); font-weight: 600;
  padding: .8rem 1rem; text-align: left;
  border-bottom: 1px solid var(--line);
}
.admin-table td {
  padding: .8rem 1rem; text-align: left;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
.admin-table tr:last-child td { border-bottom: 0; }
.admin-table tr[data-superset="true"] td { background: rgba(251, 191, 36, .06); }
.admin-table tr:hover td { background: var(--surface-2); }
.admin-table code {
  background: var(--surface-3); padding: .12rem .4rem;
  border-radius: 4px; font-size: .8rem;
}

/* ── Empty / meta / link-list ─────────────────────────────────────────────── */
.admin-empty {
  padding: 3rem 2rem; text-align: center;
  color: var(--fg-muted);
  background: var(--surface-1);
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  font-size: .9rem;
}
.admin-empty code {
  background: var(--surface-2); color: var(--accent);
  padding: .15rem .45rem; border-radius: 4px;
}
.admin-meta { color: var(--fg-muted); margin-bottom: 1rem; font-size: .88rem; }
.admin-meta strong { color: var(--fg); font-weight: 600; }

.admin-link-list {
  list-style: none; padding: 0; margin: 0;
  display: grid; gap: .35rem;
}
.admin-link-list a {
  display: flex; align-items: center; justify-content: space-between;
  padding: .7rem .9rem;
  border-radius: var(--radius-sm);
  color: var(--fg);
  background: transparent;
  border: 1px solid var(--line);
  transition: all .15s ease;
  font-weight: 500; font-size: .88rem;
}
.admin-link-list a:hover {
  background: var(--surface-2);
  border-color: var(--line-accent);
  transform: translateX(2px);
}

/* ── Animations ─────────────────────────────────────────────── */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .35; }
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.admin-card, .admin-table, .admin-empty { animation: fadeIn .3s ease-out; }

/* ── Responsive ─────────────────────────────────────────────── */
@media (max-width: 900px) {
  .admin-shell { grid-template-columns: 1fr; }
  .admin-sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
  .admin-main { padding: 1.5rem 1.25rem 3rem; }
  .admin-grid--2, .admin-grid--3 { grid-template-columns: 1fr; }
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
const ICON_CHART = `<svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
const ICON_TERMINAL = `<svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_GRAPH = `<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/></svg>`;
