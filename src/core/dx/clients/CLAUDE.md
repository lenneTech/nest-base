# `src/core/dx/clients/` — Dev-Portal SPA source

Every `/dev/*`, `/admin/*`, `/errors`, and `/api/openapi` HTML page is
served by this React 19 SPA. The legacy `*-ui.ts` server renderers
were deleted in the full-migration slice — `dist/dev-portal/` is the
single source of UI for every developer surface.

## Hard rules

- **No native HTML inputs in net-new pages.** Every `<button>`,
  `<input>`, `<select>`, `<textarea>`, `<dialog>` etc. goes through
  `components/`. The `react-aria-components` wrappers preserve focus
  rings, ARIA roles, and keyboard navigation that bare HTML cannot
  replicate consistently.
  _Existing admin-page ports_ (e.g. `WebhookInspectorPage`,
  `AuditBrowserPage`) intentionally render bare `<input>` / `<select>`
  inside `form.admin-form` because the legacy server CSS targets those
  selectors directly — replacing them with `dp-*` wrappers would break
  the byte-for-byte fidelity contract. Use the wrappers for net-new
  surfaces; mirror the legacy DOM when porting.
- **No `process.env.*` or Node imports.** This tree is browser-only.
  TypeScript `tsconfig.client.json` excludes Node types so this fails
  at compile time.
- **No CSS-in-JS / Tailwind / preprocessors.** Vanilla CSS + custom
  properties from `styles/tokens.css`. Page chrome lives in
  `styles/admin-layout.css` (1:1 port of the legacy
  `ADMIN_LAYOUT_CSS` plus every per-page `<style>` block from the
  former `*-ui.ts` renderers).
- **Re-use the legacy classnames.** A React tree for `/admin/foo`
  emits the same `.foo-tile`, `.foo-section`, `.admin-card`, … markup
  the deleted `foo-ui.ts` once produced. This is what keeps the visual
  diff zero.
- **`.js` import suffix everywhere** (ESM convention; see
  `src/core/CLAUDE.md`).

## Layout

```
clients/
├── main.tsx                       ← entry — boots React + Router + Query
├── App.tsx                        ← route table (every page lazy-loaded)
├── layout/
│   ├── AdminShell.tsx             ← shell (sidebar + header + content)
│   ├── nav.ts                     ← sidebar nav model + SPA_ROUTES set
│   └── icons.tsx                  ← SVG icons inlined per dev-portal
├── pages/
│   ├── DevHubLandingPage.tsx      ← /dev — landing dashboard
│   ├── FeaturesPage.tsx           ← /dev/features — feature toggles
│   ├── CoveragePage.tsx           ← /dev/coverage — coverage summary
│   ├── TestsPage.tsx              ← /dev/tests — test summary
│   ├── DiagnosticsPage.tsx        ← /dev/diagnostics — runtime diagnostics
│   ├── LogsPage.tsx               ← /dev/logs — live log buffer
│   ├── TracesPage.tsx             ← /dev/traces — request traces
│   ├── QueriesPage.tsx            ← /dev/queries — Prisma query buffer
│   ├── RoutesPage.tsx             ← /dev/routes — route inventory
│   ├── ErdPage.tsx                ← /dev/erd — Prisma ERD (Mermaid via CDN)
│   ├── EmailPreviewPage.tsx       ← /dev/email-preview — email templates
│   ├── PostgrestParsePage.tsx     ← /dev/postgrest-parse — wraps JsonViewer
│   ├── ComponentShowcasePage.tsx  ← /dev/components (living style guide)
│   ├── PermissionTesterPage.tsx   ← /admin/permissions/test
│   ├── WebhookInspectorPage.tsx   ← /admin/webhooks
│   ├── RealtimeInspectorPage.tsx  ← /admin/realtime
│   ├── AuditBrowserPage.tsx       ← /admin/audit
│   ├── SearchTesterPage.tsx       ← /admin/search
│   ├── ErrorsPage.tsx             ← /errors (wraps JsonViewer)
│   └── OpenApiPage.tsx            ← /api/openapi (wraps JsonViewer)
├── components/                    ← react-aria-components wrappers + JsonViewer
│   └── index.ts                   ← barrel export
├── lib/
│   └── api.ts                     ← fetchJson + format helpers shared by every page
└── styles/
    ├── tokens.css                 ← :root design-token vars
    ├── admin-layout.css           ← server-CSS port — page chrome + per-page styles
    └── components.css             ← .dp-* react-aria primitive styles
```

## Adding a new page

1. Add a route to `App.tsx` with `React.lazy`.
2. Add the corresponding sidebar entry to `layout/nav.ts` (extend
   `NAV_SECTIONS` and add the path to `SPA_ROUTES` so the link uses
   react-router and not a full reload).
3. Add a `*.json` endpoint in `dev-hub.controller.ts` (for `/dev/*`)
   or `admin-spa.controller.ts` (for `/admin/*`) — the controller does
   the planning, returns JSON, the React page renders.
4. Add a controller `@Get()` for the HTML route that returns
   `renderDevPortalShell(buildDevPortalShellInput({ title: "…" }))` —
   the SPA shell hosts the React tree, react-router decides which page
   to render based on the URL.
5. Wrap the page body in `<AdminShell title=… subtitle=… currentNav=…>`.
6. Re-use the legacy classnames from `admin-layout.css` so the visual
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
