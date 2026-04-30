# Extending the Dev Hub

The dev-hub at `/dev`, every `/admin/*` page, `/errors`, and
`/api/openapi` are served by a single **React 19 SPA** rooted at
`src/core/dx/clients/`. The shell is dark-mode (pure-black + electric-
lime accent `#c5fb45`) and lives in `clients/layout/AdminShell.tsx`;
every page plugs into it via the `<AdminShell>` wrapper. The legacy
server-side `*-ui.ts` renderers were deleted in the full-migration
slice — there is no HTML-from-Nest path anymore.

This skill covers the two common cases:

1. **Add a JSON endpoint** that should render with the dev-portal's
   shared `JsonViewer` component instead of dumping
   `application/json` to the browser.
2. **Add a brand-new admin/dev page** with a custom React layout.

---

## Case 1 — Wrap a JSON endpoint in the shared `JsonViewer`

The pattern: the controller does content negotiation between
`application/json` (SDK consumers) and `text/html` (browsers); on the
HTML branch the controller returns the dev-portal SPA shell, and the
React tree at the matching route fetches `?format=json` and renders
the result through `<JsonViewer>`.

### Reference implementation

`src/core/errors/error-code.controller.ts:list()` is the canonical
example. The HTML branch returns
`renderDevPortalShell(buildDevPortalShellInput({ title: "Error Catalog" }))`
and the React `ErrorsPage` fetches `/errors?format=json` and renders
the catalogue through `<JsonViewer>`.

### React page

See `src/core/dx/clients/pages/ErrorsPage.tsx` and
`OpenApiPage.tsx` for two-line implementations: `useQuery` over
`fetchJson`, then `<JsonViewer value={data} rawJsonHref=… />` inside
an `<AdminShell>`.

Wire the new route in `App.tsx` (`React.lazy` + `<Route path="/things">`)
and the sidebar entry in `clients/layout/nav.ts` (`NAV_SECTIONS`
+ `SPA_ROUTES`).

### Auth + tenant exemption (if the route is public)

If the page is dev-only or public, add the path to:

- `src/core/multi-tenancy/tenant-guard.ts` (`EXEMPT_EXACT` or
  `EXEMPT_PREFIXES`)
- `src/core/auth/jwt-middleware.ts` (`PUBLIC_EXACT` or
  `PUBLIC_PREFIXES`) when JWT/session must be skipped

### E2E test

```typescript
it("returns the SPA shell for browsers", async () => {
  const res = await request(app.getHttpServer()).get("/things").set("Accept", "text/html");
  expect(res.headers["content-type"]).toMatch(/text\/html/);
  expect(res.text).toContain('<div id="root"></div>');
  expect(res.text).toContain("Things — nest-server");
});

it("returns JSON when Accept: application/json", async () => {
  const res = await request(app.getHttpServer()).get("/things").set("Accept", "application/json");
  expect(res.headers["content-type"]).toMatch(/application\/json/);
});
```

---

## Case 2 — Add a brand-new admin/dev page (custom React layout)

### Reference implementations

- `src/core/dx/clients/pages/FeaturesPage.tsx` — feature catalog with
  toggles + restart overlay
- `src/core/dx/clients/pages/CoveragePage.tsx` — totals tiles +
  per-file table
- `src/core/dx/clients/pages/PermissionTesterPage.tsx` — form-driven
  page that fetches a JSON sidecar based on URL query params

### The pattern

Every page is a **React component** that:

1. Reads `useLocation()` for URL state (filter params, IDs).
2. Calls `useQuery` against a `*.json` sidecar.
3. Renders inside `<AdminShell title=… subtitle=… currentNav=…>`.
4. Re-uses the shared `admin-card` / `admin-table` / `admin-grid`
   classes from `clients/styles/admin-layout.css`.

### Add the controller route + JSON sidecar

```typescript
// In dev-hub.controller.ts (for /dev/*) or admin-spa.controller.ts (for /admin/*)
@Get("things")
@Header("content-type", "text/html; charset=utf-8")
thingsPage(): string {
  this.assertDev();
  return renderDevPortalShell(buildDevPortalShellInput({ title: "Things" }));
}

@Get("things.json")
thingsJson(): { things: Thing[] } {
  this.assertDev();
  return { things: this.gatherThings() };
}
```

### Wire the route + sidebar

1. **App.tsx** — add `<Route path="/dev/things" element={<ThingsPage />} />`
   (lazy-loaded).
2. **nav.ts** — add the sidebar entry to the appropriate section, and
   add `/dev/things` to `SPA_ROUTES` so the link uses react-router.
3. **layout/icons.tsx** — if the icon doesn't exist, add it (16x16 SVG,
   single colour, stroke-width 1.75).
4. **dev-portal-pages.story.test.ts** — add `/dev/things` to
   `expectedRoutes`, `spaPaths`, and the JSON-endpoint list. The
   story test pins the route ↔ sidebar ↔ JSON contract mechanically.

### Theme tokens you can use

CSS variables declared in `clients/styles/tokens.css` and
`admin-layout.css`:

| Variable                                                     | Purpose                                            |
| ------------------------------------------------------------ | -------------------------------------------------- |
| `--bg`, `--surface-1`, `--surface-2`, `--surface-3`          | Background layers (near-black to elevated)         |
| `--fg`, `--fg-muted`, `--fg-dim`, `--fg-faint`               | Text contrast tiers                                |
| `--accent`, `--accent-soft`, `--accent-glow`, `--accent-ink` | Lime accent + ink for accent backgrounds           |
| `--ok`, `--warn`, `--err`                                    | Status semantics                                   |
| `--line`, `--line-strong`, `--line-accent`                   | Border tiers                                       |
| `--radius`, `--radius-sm`, `--radius-lg`                     | Corner radii                                       |
| `--ease`, `--ease-out`                                       | Premium easing curves (cubic-bezier(0.16,1,0.3,1)) |
| `--font-sans`, `--font-mono`                                 | Inter + JetBrains Mono                             |

### Reusable component classes

| Class                              | What it gives you                                             |
| ---------------------------------- | ------------------------------------------------------------- |
| `.admin-card`                      | Padded surface with border, hover-lift on `:hover`            |
| `.admin-card--accent`              | Card with lime border                                         |
| `.admin-card__title`               | Semibold heading inside a card                                |
| `.admin-empty`                     | Dashed-border empty state                                     |
| `.admin-meta`                      | Muted body text                                               |
| `.admin-table`                     | Styled table — pair with `tr[data-*]` selectors for row tints |
| `.admin-grid.admin-grid--2/--3`    | 2/3-column grid of cards                                      |
| `form.admin-form` + `.row`         | Inline form layout                                            |
| `.admin-link-list`                 | Vertical list of links with hover-lift                        |
| `.admin-badge.--ok/.--warn/.--err` | Status pills with pulse on `--ok`                             |

### Coverage exclusion

The whole `clients/` tree is excluded from the coverage gate (see
`vitest.config.ts`). UI is exercised by the React-Router smoke tests +
the live page. **Don't** put functional logic in `clients/`; if a
React page needs a non-trivial transform, extract it into a sibling
`src/core/dx/` planner module that has its own story test, and have
the JSON sidecar consume the planner.

---

## Layout rules to keep the design coherent

1. **One primary action per page.** Lime CTA, everything else neutral.
2. **Tabular figures for numbers.** The shell already sets
   `font-variant-numeric: tabular-nums` on common selectors; keep new
   numeric columns on the same pattern.
3. **Lime is for "good / active / primary" only.** Errors stay red,
   warnings amber. Never lime an error pill.
4. **Hover-lift, not snap.** `transition: ... .25s var(--ease)` on
   anything interactive. `transform: translateY(-1px)` on hover-lift.
5. **Pulse on live indicators only.** Status dots that represent
   real-time state get the `pulse 2s ease-in-out infinite` animation.
6. **React handles escaping by default.** Don't bypass it — the only
   `dangerouslySetInnerHTML` usage today is the search-tester
   `ts_headline` snippet, and the trust boundary is documented in
   `SearchTesterPage.tsx`.

---

## Don't

- **Don't return server-rendered HTML from a controller.** Always go
  through the SPA shell + a `*.json` sidecar.
- **Don't hard-code colours.** Use the CSS variables.
- **Don't use emojis as icons** — SVG only (see `clients/layout/icons.tsx`).
- **Don't pull external CSS frameworks.** The dev-portal is intentionally
  zero-build (~25KB tokens + admin-layout CSS), no Tailwind, no CSS-in-JS.
- **Don't skip the story test.** Even when the React page is mostly
  glue, the route ↔ sidebar ↔ JSON-endpoint contract must be pinned in
  `tests/stories/dev-portal-pages.story.test.ts`.
