# `src/core/dx/clients/` — Dev-Portal SPA source

This is the React 19 single-page-app served at `/dev/*`. The
server-rendered cockpit (`src/core/dx/*-ui.ts`, `dashboard-ui.ts`,
`admin-layout.ts`) still exists for legacy `/dev/*` and every
`/admin/*` page; this tree is the migration target for one-page-at-a-time
React replacements.

## Hard rules

- **No native HTML inputs.** Every `<button>`, `<input>`, `<select>`,
  `<textarea>`, `<dialog>` etc. goes through `components/`. The
  `react-aria-components` wrappers preserve focus rings, ARIA roles,
  and keyboard navigation that bare HTML cannot replicate consistently.
- **No `process.env.*` or Node imports.** This tree is browser-only.
  TypeScript `tsconfig.client.json` excludes Node types so this fails
  at compile time.
- **No CSS-in-JS / Tailwind / preprocessors.** Vanilla CSS + custom
  properties from `styles/tokens.css`. Add component-specific selectors
  to `styles/components.css` next to the component declaration.
- **`.js` import suffix everywhere** (ESM convention; see
  `src/core/CLAUDE.md`).

## Layout

```
clients/
├── main.tsx                ← entry point — boots React + Router + Query
├── App.tsx                 ← layout shell + route table
├── components/             ← react-aria-components wrappers (Button, Select, …)
│   └── index.ts            ← barrel export
├── pages/
│   ├── DevHubLandingPage.tsx
│   └── ComponentShowcasePage.tsx
└── styles/
    ├── tokens.css          ← :root design-token vars (synced with admin-layout.ts)
    └── components.css      ← .dp-* component classes
```

## Build

`scripts/build-dev-portal.ts` invokes `Bun.build({ target: "browser",
splitting: true, minify: true })` and writes the bundle to
`dist/dev-portal/`. The output is gitignored. Hot reload in dev: the
build script accepts a `--watch` flag and `scripts/dev.ts` starts it
in parallel with the API.

## Coverage

This subtree is **excluded from the ≥ 70 % core coverage threshold**
(see `vitest.config.ts` and `docs/code-guidelines.md`). The
**shell renderer** (`../dev-portal-shell.ts`) is still covered by a
story test — it is the only file in the migration with a coverage
contract because it crosses the trust boundary (server → browser).

UI glue here is exercised manually in development and by future
Playwright/Chrome-DevTools-MCP smoke tests; both are fine, neither is
counted in `bun run test:coverage`.

## When you add a component

1. Wrap `react-aria-components`. Never re-implement the underlying
   primitive yourself.
2. Add `dp-<name>` selectors to `styles/components.css`.
3. Re-export from `components/index.ts`.
4. Show every variant in `pages/ComponentShowcasePage.tsx` — the
   showcase is the contract: if it isn't in the showcase, it doesn't
   exist for downstream pages.
