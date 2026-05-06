# `src/core/dx/clients/` — Dev-Portal SPA source

Every `/dev/*`, `/admin/*`, `/errors`, and `/api/openapi` HTML page is
served by this React 19 SPA. The legacy server-side `*-ui.ts`
renderers are gone — `dist/dev-portal/` is the single source of UI
for every developer surface.

## Stack

- **React 19** + **react-router-dom 7** for the route tree
- **Tailwind CSS 4** (CSS-first `@theme` config in `styles/globals.css`)
- **shadcn/ui primitives**, vendored under `components/ui/` (no npm
  package; the source lives in this tree)
- **Radix UI** for the underlying primitive layer that shadcn wraps
- **TanStack Query** for the JSON-loader chain
- **`sonner`** for toast notifications
- **`bun-plugin-tailwind`** for the build (Bun bundle ↔ Tailwind
  oxide compiler)

## Hard rules

- **No native HTML inputs / buttons / selects in net-new pages.**
  Every interactive primitive comes from `components/ui/` (Button,
  Input, Select, Switch, …) or from a parent shadcn family
  (Dialog/DialogContent, Tabs/TabsTrigger, …). Native elements are
  fine inside the legacy ports where the existing styling already
  lands them somewhere coherent — but new code uses shadcn.
- **No `process.env.*` or Node imports.** This tree is browser-only.
  TypeScript `tsconfig.client.json` excludes Node types so this fails
  at compile time.
- **Tailwind first, shadcn second, hand-rolled CSS only when both
  fail.** The dev-portal design tokens live in `styles/tokens.css`
  (the brand-loader's runtime override target — see below) and are
  exposed to Tailwind via the `@theme` block in `styles/globals.css`.
  Use utility classes (`bg-surface-2`, `text-fg-muted`,
  `border-line`, `text-accent`, `bg-ok/15 text-ok`, …) instead of
  inline styles.
- **`.js` import suffix everywhere** (ESM convention; see
  `src/core/CLAUDE.md`).
- **Path alias**: `@/components/ui/*` is wired in `tsconfig.client.json`,
  but every existing import uses relative paths (`../../components/ui/button.js`).
  Prefer the relative form to keep the bundler simple.

## Brand integration (Issue #5 hot-reload)

The dev-portal-shell server-renderer (`../dev-portal-shell.ts`)
inlines the brand-derived `:root { --accent: …; --bg: …; … }`
declarations as a `<style>` block right after the static `tokens.css`
link. Because `globals.css` (Tailwind's `@theme`) maps every shadcn
semantic colour to those CSS-vars, **brand changes propagate
automatically** — the operator edits `brand.json`, the dev-runner
restarts the API, the next page load picks up the new brand without
a code change anywhere.

If you add a new theme token, add it in three places:

1. `styles/tokens.css` — declare the default value.
2. `styles/globals.css` — alias it under `@theme` so Tailwind utilities
   resolve to it.
3. `src/core/branding/brand-css.ts` — emit the `--token: …` override
   in the brand-loader's CSS-var generator.

## Layout

```
clients/
├── main.tsx                       ← entry — boots React + Router + Query + Sonner
├── App.tsx                        ← route table (every page lazy-loaded)
├── global.d.ts                    ← ambient types (CSS imports, mermaid)
├── layout/
│   ├── AdminShell.tsx             ← shell (sidebar + header + content)
│   ├── nav.ts                     ← sidebar nav model + SPA_ROUTES set
│   └── icons.tsx                  ← SVG icons inlined per dev-portal
├── pages/
│   ├── DevHubLandingPage.tsx      ← /dev — landing dashboard
│   ├── FeaturesPage.tsx           ← /dev/features
│   ├── BrandPage.tsx              ← /dev/brand
│   ├── CoveragePage.tsx           ← /dev/coverage
│   ├── TestsPage.tsx              ← /dev/tests
│   ├── DiagnosticsPage.tsx        ← /dev/diagnostics
│   ├── LogsPage.tsx               ← /dev/logs
│   ├── TracesPage.tsx             ← /dev/traces
│   ├── QueriesPage.tsx            ← /dev/queries
│   ├── MigrationsPage.tsx         ← /dev/migrations (5 tabs)
│   ├── JobsPage.tsx               ← /dev/jobs
│   ├── RoutesPage.tsx             ← /dev/routes
│   ├── ErdPage.tsx                ← /dev/erd
│   ├── EmailPreviewPage.tsx       ← /dev/email-preview
│   ├── EmailBuilderPage.tsx       ← /dev/email-builder
│   ├── PostgrestParsePage.tsx     ← /dev/postgrest-parse
│   ├── FileManagerPage.tsx        ← /dev/files
│   ├── ComponentShowcasePage.tsx  ← /dev/components (living shadcn showcase)
│   ├── PermissionTesterPage.tsx   ← /admin/permissions/test
│   ├── WebhookInspectorPage.tsx   ← /admin/webhooks
│   ├── RealtimeInspectorPage.tsx  ← /admin/realtime
│   ├── AuditBrowserPage.tsx       ← /admin/audit
│   ├── SearchTesterPage.tsx       ← /admin/search
│   ├── ErrorsPage.tsx             ← /errors
│   └── OpenApiPage.tsx            ← /api/openapi
├── components/
│   ├── JsonViewer.tsx             ← shared JSON-tree component
│   ├── PageState.tsx              ← Loading / Error / Empty / StatTile helpers
│   ├── Sparkline.tsx              ← inline SVG sparkline (used by webhooks)
│   └── ui/                        ← shadcn primitives (badge, button, card,
│                                     checkbox, dialog, dropdown-menu, input,
│                                     label, progress, radio-group, select,
│                                     separator, sheet, sonner, switch, table,
│                                     tabs, textarea, tooltip)
├── lib/
│   ├── api.ts                     ← fetchJson + format helpers
│   └── utils.ts                   ← cn() — clsx + tailwind-merge
└── styles/
    ├── tokens.css                 ← :root design-token vars
    └── globals.css                ← `@import "tailwindcss"` + `@theme`
                                     bridge mapping shadcn colours →
                                     dev-portal tokens
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
6. Use the shadcn primitives + Tailwind utilities (and the
   `PageState` helpers) for the body.

## Adding a new component

1. **Look in shadcn-ui's registry first**:
   <https://ui.shadcn.com/docs/components>. If the component exists,
   vendor the canonical source under `components/ui/<name>.tsx`,
   adapt the import paths to `../../lib/utils.js`, and add the
   `.js` suffix to every relative import. This is exactly what
   `bunx shadcn@latest add <name>` would do — we do it manually so
   the registry tooling doesn't need network in CI.
2. **Add at least one example to `pages/ComponentShowcasePage.tsx`** —
   the showcase is the contract: if it isn't on the showcase, it
   doesn't exist for downstream pages.
3. If the component depends on a Radix primitive that isn't yet a
   dep, install it (`bun add @radix-ui/react-<name>`).

## Build

`scripts/build-dev-portal.ts` invokes `Bun.build({ target: "browser",
splitting: true, minify: true, plugins: [bunPluginTailwind] })` and
writes the bundle to `dist/dev-portal/`. The output is gitignored.
`bun run dev` awaits the initial build before spawning the API so
`/dev/static/main.js` is never missing on first paint, then starts a
watcher for incremental rebuilds (~80 ms warm).

## Coverage

This subtree is **excluded from the ≥ 80 % core coverage threshold**
(see `vitest.config.ts` and `docs/code-guidelines.md`). The
**shell renderer** (`../dev-portal-shell.ts`) is still covered by a
story test — it is the only file in the migration with a coverage
contract because it crosses the trust boundary (server → browser).

The cross-tier contract (route table ↔ sidebar nav ↔ JSON endpoints
↔ Tailwind theme bridge) is mechanically pinned by
`tests/stories/dev-portal-pages.story.test.ts`.

## Bundle size

The bundle target is **≤ 1.2 MB total** for `dist/dev-portal/*.js +
*.css`. Verify with `bun run build:dev-portal && du -h
dist/dev-portal/main.js dist/dev-portal/main.css`. Tailwind purge
keeps the CSS lean; lazy-loaded page chunks keep the JS lean.
