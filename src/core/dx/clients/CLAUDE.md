# `src/core/dx/clients/` — Dev-Portal SPA source

Every `/dev/*` HTML page is now served by this React 19 SPA. The
legacy `*-ui.ts` server renderers stay reachable at `/dev/<name>.html`
for pixel-fidelity diffing — they are no longer the canonical URL.
`/admin/*` is **out of scope** and stays server-rendered.

## Hard rules

- **No native HTML inputs.** Every `<button>`, `<input>`, `<select>`,
  `<textarea>`, `<dialog>` etc. goes through `components/`. The
  `react-aria-components` wrappers preserve focus rings, ARIA roles,
  and keyboard navigation that bare HTML cannot replicate consistently.
- **No `process.env.*` or Node imports.** This tree is browser-only.
  TypeScript `tsconfig.client.json` excludes Node types so this fails
  at compile time.
- **No CSS-in-JS / Tailwind / preprocessors.** Vanilla CSS + custom
  properties from `styles/tokens.css`. Page chrome lives in
  `styles/admin-layout.css` (1:1 port of the server `ADMIN_LAYOUT_CSS`
  plus every per-page `<style>` block from the `*-ui.ts` renderers).
- **Re-use the server classnames.** A React tree for `/dev/foo`
  emits the same `.foo-tile`, `.foo-section`, `.admin-card`, … markup
  that `foo-ui.ts` produced. This is what keeps the visual diff zero.
- **`.js` import suffix everywhere** (ESM convention; see
  `src/core/CLAUDE.md`).

## Layout

```
clients/
├── main.tsx                       ← entry — boots React + Router + Query
├── App.tsx                        ← route table (every page lazy-loaded)
├── layout/
│   ├── AdminShell.tsx             ← React port of admin-layout.ts (sidebar + header + content)
│   ├── nav.ts                     ← sidebar nav model — mirrors defaultAdminNav() server-side
│   └── icons.tsx                  ← SVG icons mirroring admin-layout.ts ICON_* exports
├── pages/
│   ├── DevHubLandingPage.tsx      ← /dev — port of dashboard-ui.ts
│   ├── FeaturesPage.tsx           ← /dev/features — port of features-ui.ts
│   ├── CoveragePage.tsx           ← /dev/coverage — port of coverage-ui.ts
│   ├── TestsPage.tsx              ← /dev/tests — port of test-summary-ui.ts
│   ├── DiagnosticsPage.tsx        ← /dev/diagnostics — port of diagnostics-ui.ts
│   ├── LogsPage.tsx               ← /dev/logs — port of log-viewer-ui.ts
│   ├── TracesPage.tsx             ← /dev/traces — port of trace-viewer-ui.ts
│   ├── QueriesPage.tsx            ← /dev/queries — port of query-viewer-ui.ts
│   ├── RoutesPage.tsx             ← /dev/routes — port of route-inventory-ui.ts
│   ├── ErdPage.tsx                ← /dev/erd — port of erd-ui.ts (Mermaid via CDN)
│   ├── EmailPreviewPage.tsx       ← /dev/email-preview — port of email-preview-ui.ts
│   ├── PostgrestParsePage.tsx     ← /dev/postgrest-parse — wraps JsonViewer
│   └── ComponentShowcasePage.tsx  ← /dev/components (living style guide)
├── components/                    ← react-aria-components wrappers + JsonViewer
│   └── index.ts                   ← barrel export
├── lib/
│   └── api.ts                     ← fetchJson + format helpers shared by every page
└── styles/
    ├── tokens.css                 ← :root design-token vars (synced with admin-layout.ts)
    ├── admin-layout.css           ← server-CSS port — page chrome + per-page styles
    └── components.css             ← .dp-* react-aria primitive styles
```

## Adding a new page

1. Add a route to `App.tsx` with `React.lazy`.
2. Add the corresponding sidebar entry to `layout/nav.ts` (and the
   matching server-side entry in `admin-layout.ts`'s `defaultAdminNav()`
   if it should also show on a server-rendered admin page).
3. Add a `*.json` endpoint in `dev-hub.controller.ts` if the page needs
   data the existing endpoints don't expose.
4. Wrap the page body in `<AdminShell title=… subtitle=… currentNav=…>`.
5. Re-use the server classnames from `admin-layout.css` so the visual
   diff stays zero.

## Build

`scripts/build-dev-portal.ts` invokes `Bun.build({ target: "browser",
splitting: true, minify: true })` and writes the bundle to
`dist/dev-portal/`. The output is gitignored. `bun run dev` awaits the
initial build before spawning the API so `/dev/static/main.js` is never
missing on first paint, then starts a watcher for incremental rebuilds
(~80 ms warm).

## Coverage

This subtree is **excluded from the ≥ 70 % core coverage threshold**
(see `vitest.config.ts` and `docs/code-guidelines.md`). The
**shell renderer** (`../dev-portal-shell.ts`) is still covered by a
story test — it is the only file in the migration with a coverage
contract because it crosses the trust boundary (server → browser).

UI glue here is exercised manually in development and by future
Playwright/Chrome-DevTools-MCP smoke tests; both are fine, neither is
counted in `bun run test:coverage`. The cross-tier contract (route
table ↔ sidebar nav ↔ JSON endpoints ↔ classname catalogue) is
mechanically pinned by `tests/stories/dev-portal-pages.story.test.ts`.

## When you add a component

1. Wrap `react-aria-components`. Never re-implement the underlying
   primitive yourself.
2. Add `dp-<name>` selectors to `styles/components.css`.
3. Re-export from `components/index.ts`.
4. Show every variant in `pages/ComponentShowcasePage.tsx` — the
   showcase is the contract: if it isn't in the showcase, it doesn't
   exist for downstream pages.
