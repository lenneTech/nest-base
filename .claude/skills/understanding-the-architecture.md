# Understanding the Architecture

A 200-line tour of the conceptual building blocks. Read this before
you implement anything substantial. The full rationale lives in
[`docs/architecture.md`](../../docs/architecture.md); this file is the
"executive summary" optimised for an AI agent that needs to make
correct decisions fast. For coding conventions see
[`docs/code-guidelines.md`](../../docs/code-guidelines.md).

---

## The five non-negotiable principles

### 1. `features.ts` is the single source of truth

`src/core/features/features.ts` exports `FeaturesSchema` (Zod). Every
toggleable subsystem reads it. Every conditional module import goes
through it. **Never** reach for `process.env.FEATURE_*` directly —
`loadFeatures(env)` is the one place ENV vars become typed config.

Why: the parser handles section-key normalisation (`POWERSYNC` →
`powerSync`), validation, and defaults. Bypassing it leads to drift
between the runtime check, the catalog UI, and the diagnostics report.

### 2. Pure-planner / thin-runner split

Every helper that touches I/O is split:

- **Planner** — pure function. No `fs`, no `node:net`, no `process`,
  no Date.now (takes `now: () => number`). Inputs explicit, outputs
  deterministic. Tests run without Docker, without Postgres, in
  milliseconds.
- **Runner** — thin glue. Reads files, calls `child_process.spawn`,
  passes the result to the planner, applies the output.

**Examples**:

- `src/core/setup/sync-from-template.ts` (planner) +
  `scripts/sync-from-template.ts` (runner)
- `src/core/throttler/throttler.ts` (planner; takes `now: () => number`) +
  Postgres adapter (runner)
- `src/core/dx/env-file-update.ts` (planner) +
  `dev-hub.controller.ts:toggleFeature()` (runner with `readFile`/`writeFile`)
- `src/core/dx/coverage-report.ts` (planner: parsed JSON → report) +
  controller (runner: reads `coverage/coverage-summary.json`)

When you add a new helper, **start with the planner**. Story-test it.
The runner is a final thin wrapper.

### 3. Template-owned core, project-owned modules

```
src/
├── core/      ← template-owned. `bun run sync:from-template` overwrites this.
└── modules/   ← project-owned. Sync guarantees this is untouched.
```

Code in `src/core/` ships to every project that consumes the template.
Code in `src/modules/` is your business logic. The boundary is hard:
the sync planner refuses to touch anything outside `src/core/`.

When you write something general (rate-limiter, error filter, dev tool)
→ `src/core/`. When you write something project-specific (Order entity,
domain events, feature business logic) → `src/modules/`.

### 4. The output pipeline (4 stages)

`src/core/output-pipeline/` runs on every controller response, before
the JSON serialiser. The four stages, in order:

1. **CASL ability** — drop records the user cannot read.
2. **Field allow-list** — strip fields the user cannot see (per-record).
3. **Remove secrets** — drop known-secret-shaped fields (regex on
   field names: `*Secret`, `*Token`, `password*`, etc.).
4. **Safety net** — final pattern scan for anything that looks like a
   secret leak (UUIDs are fine, AWS keys are not).

The pipeline is a global `APP_INTERCEPTOR` (see `src/core/app/app.module.ts`).
Stages 1+2 require an `Ability` on the request; the
`PermissionInterceptor` resolves it.

If you add a new entity that returns from a controller, you don't need
to wire anything — the pipeline handles it. Just don't expose
`*Secret`-style field names you actually want returned (rename, or
explicitly opt out).

### 5. Six quality gates per commit

| Gate     | Command                 | What it checks                   |
| -------- | ----------------------- | -------------------------------- |
| Lint     | `bun run lint`          | oxlint with 95 rules             |
| Format   | `bun run format`        | oxfmt — double-quotes default    |
| Types    | `bun run test:types`    | tsc compile-check on tests/types |
| Unit     | `bun run test:unit`     | pure-function tests              |
| E2E      | `bun run test:e2e`      | story tests + HTTP e2e           |
| Coverage | `bun run test:coverage` | ≥ 90% core, ≥ 80% modules        |
| Build    | `bun run build`         | bundle to dist/                  |

Failing any gate blocks the commit. `*:fix` siblings exist for lint
and format. Coverage drops force you to write more tests, not exclude
files.

---

## The dev hub layer

Every developer-facing HTML surface — `/dev/*`, `/admin/*`, `/errors`,
`/api/openapi` — is served by a single React 19 SPA bundled by
`bun build` and emitted to `dist/dev-portal/`. The Nest controllers
(`dev-hub.controller.ts`, `admin-spa.controller.ts`,
`error-code.controller.ts`, the `/api/openapi` mount in
`bootstrap.ts`) all return the same thin HTML shell
(`renderDevPortalShell`); React + react-router decides what to render.
Each page reads from a sibling `*.json` sidecar — never inlines data
into the HTML.

The composition:

```
clients/                  ← React 19 SPA source (TypeScript + react-aria)
├── main.tsx              ← bundle entry; mounted by the shell
├── App.tsx               ← lazy-loaded route table
├── layout/AdminShell.tsx ← sidebar + header + active-nav highlight
├── pages/                ← one tsx file per route (admin + dev + errors + openapi)
├── components/           ← react-aria-component wrappers + JsonViewer
└── styles/               ← tokens.css, admin-layout.css, components.css

dev-portal-shell.ts       ← server-side shell renderer (`<div id="root">`)
dev-hub.controller.ts     ← /dev/* SPA shell + JSON sidecars
admin-spa.controller.ts   ← /admin/* SPA shell + JSON sidecars
```

The whole `clients/` tree is **coverage-excluded** in `vitest.config.ts`.
The cross-tier contract — route ↔ sidebar ↔ JSON-endpoint mapping —
is mechanically pinned by `tests/stories/dev-portal-pages.story.test.ts`.
Real verification is visual (open the page).

The theme is **near-black surfaces + electric-lime accent (#c5fb45)**.
CSS variables in `clients/styles/tokens.css` and `admin-layout.css`
define every colour, radius, easing. Don't hard-code values.

---

## Auth + permissions

**Better-Auth 1.6** handles auth (email/password, social, passkey, 2FA,
API keys). Wired in `src/core/auth/better-auth.module.ts` via a
factory provider that reads `BETTER_AUTH_SECRET` at provider-init
time (not at module-decoration time — important for tests).

**CASL** handles permissions. The flow:

1. Request comes in. `PermissionInterceptor` resolves an `Ability`
   per `(userId, tenantId)` (cached 60s, LRU-bounded).
2. The `@Can('read', 'Project')` decorator on a handler enforces it.
3. The output pipeline (Stage 1) drops records the ability cannot read.
4. The output pipeline (Stage 2) strips fields the ability cannot see.

DB-backed rules live in `src/core/permissions/db-rule-resolver.ts`.
The admin UI for testing rules is at `/admin/permissions/test`.

---

## Multi-tenancy

`x-tenant-id` header (UUID) carried via `AsyncLocalStorage` in
`src/core/multi-tenancy/tenant.interceptor.ts`. The interceptor
attaches the tenant to the request context, the Prisma extension
(`SET LOCAL app.tenant_id`) makes RLS see it.

Public routes (`/`, `/health/*`, `/api/auth/*`, `/dev/*`, `/admin/*`,
`/errors/*`) are exempt — see `tenant-guard.ts:isTenantExempt`.
Query strings + fragments are stripped before matching.

Multi-tenancy is a feature flag — when off, the interceptor is not
registered, no header required.

---

## Errors + RFC 7807

`src/core/errors/` defines `CORE_*` error codes with i18n messages
and HTTP status mapping. The global `ProblemDetailsExceptionFilter`
catches every exception and maps it:

- `HttpException` → reuse status + map status to `CORE_*` code
- `ZodError` → 400 + `CORE_VALIDATION` + per-field errors
- `TenantIsolationError` → 400 + `CORE_VALIDATION` + "Tenant Header Required"
- `ETagMissingError` → 428
- `ETagPreconditionFailedError` → 412
- anything else → 500 + `CORE_INTERNAL` (message redacted, stack
  logged via `console.error` for dev visibility)

The catalog is queryable at `/errors` (HTML viewer or JSON via
`Accept: application/json`).

---

## Prisma 7 driver-adapter mode

The connection URL lives in `prisma.config.ts`, **not** `schema.prisma`.
`PrismaService` constructs the client with `new PrismaPg({ connectionString })`.

Implications:

- `prisma studio` needs `--url $DATABASE_URL` (the wrapper handles this)
- Generated client lives at `node_modules/.prisma/client`
- `bun run prepare:schema` concatenates feature schemas into
  `schema.generated.prisma` before generate
- CI must run `prepare:schema && prisma:generate` before any test or build

See skill `working-with-prisma` for the full migration + concat workflow.

---

## Dev-runner specifics

`scripts/dev.ts` is the dev launcher. It:

1. Probes `127.0.0.1:443` to see if portless proxy is alive
2. Spawns either `portless run` (if alive) or `bun --watch src/main.ts`
3. **Watches `.env`** — when it changes (e.g. via /dev/features
   toggle), kills the child and respawns. Without this, env vars stay
   cached because `bun --watch` only reloads source, not env.
4. **Writes a dev-session lock** at
   `node_modules/.cache/nest-base/dev-session.json`. `bootstrap.ts`
   reads it on every init: first start ⇒ open browser + hero banner,
   re-init (watch reload or .env respawn) ⇒ skip browser, compact
   "♻ Server neu gestartet" banner. The lock survives `bun --watch`
   re-execs (which reset `process.env`) and is cleared on
   SIGINT/SIGTERM so the next cold-start re-opens the tab.

This is why feature toggles work: the `.env` patch + respawn cycle.
And this is why your tab doesn't pop on every keystroke when you
edit a source file: the lock remembers it's already open.

---

## What `src/core/dx/` is for

`dx/` = developer experience. Everything that helps devs work _on_
this server (not features the server delivers to end users) lives
here:

- `clients/layout/AdminShell.tsx` — React shell rendered for every dev/admin route
- `dashboard-ui.ts`, `*-ui.ts` — per-page renderers
- `feature-catalog.ts` — drives `/dev/features` UI
- `service-status.ts` — probes for the dashboard's service grid
- `coverage-report.ts`, `test-summary.ts` — parse Vitest output
- `log-buffer.ts` — in-memory ring of last 500 Pino records
- `env-file-update.ts` — pure planner for .env patching
- `prisma-studio.ts` — sibling-process launcher
- `browser-open.ts` — auto-open planner (cross-platform)
- `effective-base-url.ts` — pick the right URL (portless vs localhost)
- `startup-banner.ts` — terminal banner after boot

Most of these are pure planners with story tests. The runners live
in `dev-hub.controller.ts` or `bootstrap.ts`.

---

## When you write code

Match these conventions:

1. **ESM imports with `.js` suffix**: `import { x } from "./foo.js"` even when source is `foo.ts`.
2. **Named error sentinels**: `class FooBarError extends Error { constructor(...) { super(...); this.name = "FooBarError"; } }`. The filter maps known sentinels to RFC 7807.
3. **HTML-escape every user-controlled value** in renderers. Five-char table: `&` `<` `>` `"` `'`.
4. **Tabular figures** (`font-variant-numeric: tabular-nums`) for any number that updates.
5. **Lime accent only for "good / active / primary"** — errors stay red, warnings amber.
6. **Comments explain WHY, not WHAT.** Well-named code carries the _what_. If you write a comment that paraphrases the next line, delete it.

When in doubt: read the closest existing example. The codebase is
internally consistent — copy the pattern, don't reinvent it.
