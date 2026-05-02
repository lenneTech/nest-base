# Architecture

This is the load-bearing reference for *how* the server is put together —
the modules, the layered defenses, the design choices we are not going
to revisit casually. If you only have ten minutes, read this once and
then keep it open while you work.

For *how to write code that fits* this architecture, see
[`code-guidelines.md`](./code-guidelines.md). For *how to contribute
changes*, see [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## What this server is

A template-shaped NestJS server: many projects share the same
`src/core/`, each project adds its own resources in `src/modules/`. The
template itself is *not* a deployable application — consumers fork or
sync, then deploy. See [`customization-guide.md`](./customization-guide.md)
for the consumer perspective.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Bun 1.x (Node 22 fallback) | TypeScript-first, fast cold start, native test runner |
| Framework | NestJS 11 | DI, decorators, modular, runs on Bun |
| Language | TypeScript 5.9+ strict | No implicit `any`, no `@ts-ignore` |
| ORM | Prisma 7 (driver-adapter mode) | Typed, migrations, Postgres-first |
| DB | Postgres 18 | RLS, JSONB, FTS, `LISTEN/NOTIFY`, `pg_uuidv7` |
| Auth | Better-Auth 1.6 | Email/PW, OAuth, 2FA, Passkey, sessions, JWT — one stack |
| AuthZ | CASL 6 + DB-persisted rules | Industry standard; we own the persistence, not the engine |
| Validation | Zod 4 | Single SoT for DTOs and OpenAPI schemas |
| API | REST + OpenAPI 3.1 + Scalar UI | No GraphQL by design |
| Storage | S3 / Local / Postgres | Three adapters, one interface |
| Email | Nodemailer + Brevo | SMTP for dev, Brevo for prod |
| Webhooks | pg-boss + HMAC-SHA256 | Standard-Webhooks spec, see [`webhook-spec.md`](./webhook-spec.md) |
| Search | Postgres FTS (`tsvector` + GIN) | No external infra |
| Realtime | Postgres `LISTEN/NOTIFY` + Socket.IO | Multi-instance without Redis |
| Mobile sync | PowerSync + SQLite client | Offline-first |
| Encryption | AES-256-GCM via `@47ng/cloak` | Field-level, key-versioned |
| Geo | PostGIS + Mapbox/Nominatim/Google adapter | Standard Postgres-Geo, GeoJSON I/O |
| Jobs | pg-boss (Postgres-native) | Cron, background, outbox — no Redis |
| Rate limit | `@nestjs/throttler` + Postgres store | Multi-instance |
| Observability | OpenTelemetry (OTLP) + Pino | Traces + metrics + correlated logs |
| Errors | RFC 7807 Problem Details | `application/problem+json` |
| IDs | UUID v7 | Time-sorted, B-tree friendly |
| Tests | Vitest 4 (Bun test for perf only) | Bigger plugin ecosystem |
| Lint/format | oxlint + oxfmt | Rust-based, fast |
| API style | REST | No GraphQL, no subscriptions outside Socket.IO |

### Out of scope (do not add)

| Removed | Reason |
|---|---|
| GraphQL / Apollo | REST + OpenAPI is sufficient and halves complexity |
| Legacy `CoreAuthService` | Better-Auth covers everything |
| Vendor-Mode | Workaround for code comprehension; greenfield doesn't need it |
| Mailjet | Brevo covers all use cases |
| Mongoose / MongoDB / GridFS | Prisma + Postgres + S3 storage |
| `@UnifiedField` decorator | Prisma + Zod are the SoT |
| Self-built `@Restricted`/`@Roles` | Replaced by DB-configurable CASL permissions |
| `process()`-style raw pipelines | Replaced by clear service vs. repository split |

## Repository layout

```
src/
├── main.ts
├── app.module.ts
├── core/                            ← Template-owned. Synced via bun run sync:from-template.
│   ├── auth/                        ← Better-Auth integration
│   ├── permissions/                 ← CASL engine + DB persistence
│   ├── output-pipeline/             ← 4-stage interceptor (translate → CASL → filter → secrets)
│   ├── multi-tenancy/               ← Tenant resolution + Postgres RLS
│   ├── files/  storage/             ← Directus-style files, pluggable storage adapters
│   ├── email/  webhooks/            ← Outbound channels
│   ├── search/  realtime/           ← FTS, Socket.IO + LISTEN/NOTIFY
│   ├── encryption/  geo/  mcp/      ← PII encryption, PostGIS, Model-Context-Protocol
│   ├── jobs/  outbox/               ← pg-boss, outbox pattern for reliable events
│   ├── errors/  audit/              ← RFC 7807, audit log
│   ├── request-context/             ← AsyncLocalStorage per request
│   ├── observability/               ← OpenTelemetry setup
│   ├── dx/  dev/                    ← Scalar, NestJS DevTools, dev hub
│   ├── features/                    ← FeaturesSchema (zod) — single source of truth for toggles
│   └── http/  validation/  …
├── modules/                         ← Project-owned. Add your domain code here.
└── shared/                          ← Cross-tier types (channels, events, SDK seeds).
prisma/
├── schema.prisma                    ← Core schema, always present
└── features/                        ← Feature-gated schemas, concatenated by bun run prepare:schema
```

For the `core/` ↔ `modules/` boundary, see
[`customization-guide.md`](./customization-guide.md). For *what counts
as public surface*, see
[`api-stability-promise.md`](./api-stability-promise.md).

## Permission model

The system has three layers of authorization, applied in order on every
read and every write — defense in depth:

1. **Application layer (CASL)** — `can(action, subject, conditions)`
   resolved per request from DB-persisted rules. Field-level and
   item-level. This is the layer that decides *whether* a handler runs
   and *which fields* it may write.
2. **Repository layer (Prisma `WHERE`)** — `accessibleBy(ability, 'read')`
   produces a Prisma filter that is `AND`-merged into every read query.
   This is the layer that ensures a `findMany` never returns rows the
   user can't see — even if the handler forgets to filter.
3. **Database layer (Postgres RLS)** — tenant-isolation enforced by the
   database itself. This is the last-resort backstop: even a SQL
   injection that bypasses the ORM hits an RLS policy.

CASL is the engine, *we own the persistence*. The schema:

```
Role  ──→  RolePolicy  ──→  Policy  ──→  Permission(resource, action, itemFilter, fields, validation, presets)
```

- **`itemFilter`** is a JSON filter expression (Directus DSL —
  `_eq`, `_in`, `_and`, `_or`, etc.) with variable markers
  (`$CURRENT_USER`, `$CURRENT_TENANT`, `$NOW`) resolved at request time.
- **`fields`** is a string-array allowlist. **`fields = []` means "no
  field-level restriction"** — see
  [`OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md) for the rationale (CASL
  cannot represent "deny every field" in a single rule; the deny case
  is expressed by simply not granting the action).
- **`presets`** are default values applied on `CREATE`.
- **`validation`** is a JSON schema applied on `CREATE`/`UPDATE`.

`Administrator` and `Public` are system roles — `Administrator` bypasses
every check; `Public` applies to unauthenticated requests.

## Output pipeline

CASL handles read visibility (item filter) and static field allowlists.
For *instance-dependent* filtering (masking, cross-lookups, computed
visibility) we run a four-stage pipeline as a global interceptor:

```
Service returns Plain Object(s) from Prisma
  ↓ Stage 1   i18n translate (Accept-Language → _translations)
  ↓ Stage 2   CASL field allowlist (permittedFieldsOf → strip)
  ↓ Stage 3   Filter-Service (per-resource @FilterFor, async, DI-aware)
  ↓ Stage 4   Secret safety net (DEFAULT_SECRET_FIELDS + *Hash/*Token/*Secret regex)
HTTP response
```

**Order matters**: translate before allowlist (otherwise `_translations`
gets stripped); allowlist before filter-service (filters see only
permitted fields); secret safety net last (independent of everything
else).

**Filter services** live in `src/core/output-pipeline/` and
`src/modules/<resource>/<resource>.filter.service.ts`. They register
themselves via `@FilterFor('Subject')` and implement
`applyInstance(item, ctx)` — return `null` to drop the item entirely,
return the (possibly modified) item to keep it.

**The secret safety net is non-negotiable.** Even if a permission
mistakenly grants a secret field, even if a filter forgets to strip it,
the safety net removes it. New secret-shaped fields (`*Hash`, `*Token`,
`*Secret`) are picked up automatically.

## Multi-tenancy

Two-layer isolation:

- **App layer** — a request-scoped interceptor reads `tenantId` from
  the session/JWT/API-key and stores it in `AsyncLocalStorage`. Every
  CASL filter that includes `$CURRENT_TENANT` substitutes it from the
  context.
- **DB layer** — Postgres RLS policies enforce `tenant_id = current_setting('app.tenant_id')`.
  `PrismaService` sets the session variable on every connection check-out.

If app code forgets to scope a query, RLS denies the rows. If RLS is
misconfigured, CASL still denies the rows. Both layers must fail open
for a tenant leak to occur.

### Tenant self-service surface

Three HTTP routes let a signed-up user discover or create their first
tenant without going through the system-setup wizard:

| Route | Purpose | Auth | Tenant header |
|---|---|---|---|
| `GET /me/tenants` | List the joined tenant + membership rows for the authenticated caller | required | exempt |
| `POST /tenants` | Create a Tenant + an ACTIVE owner membership for the caller, atomically | required | exempt |
| `*` (everything else) | Domain endpoints | required | required (UUID) |

`/me/*` and `/tenants` live on `tenant-guard.ts`'s `EXEMPT_PREFIXES`
list — they operate on `req.user.id`, not on a specific tenant, so
the bootstrap step does not (and cannot) require an `x-tenant-id`
header. The Better-Auth session middleware still gates anonymous
access (401). See `src/core/multi-tenancy/tenant-self-service.module.ts`.

## Cross-cutting subsystems

These live in `src/core/` and are activated via `features.ts`:

| Subsystem | Path | Purpose |
|---|---|---|
| Webhooks | `src/core/webhooks/` | Outbound HMAC-signed events; see [`webhook-spec.md`](./webhook-spec.md) |
| Realtime | `src/core/realtime/` | `LISTEN/NOTIFY` → Socket.IO, permission-aware rooms, dev-only inspector state with PII-masked event ringbuffer |
| MCP | `src/core/mcp/` | Model Context Protocol server, OAuth 2.1 (PKCE) |
| Outbox | `src/core/outbox/` | Reliable event publishing (DB-write + dispatch in one tx) |
| Audit | `src/core/audit/` | Append-only audit log, write-only by app, read-only via admin |
| Jobs | `src/core/jobs/` | pg-boss wrapper for cron + background work |
| Idempotency | `src/core/idempotency/` | Stripe-style `Idempotency-Key` header |
| Concurrency | `src/core/concurrency/` | ETag / `If-Match` optimistic-lock |
| Encryption | `src/core/encryption/` | AES-256-GCM field-level, key-versioned |
| Geo | `src/core/geo/` | PostGIS + geocoding adapters |

All are **opt-in via `features.ts`** — disabled features have zero
footprint (no module load, no migration, no env-var requirement).

## Email subsystem

`src/core/email/` ships three drivers behind the `EmailDriver`
interface:

| Driver | Path | Used when |
|---|---|---|
| `SmtpEmailDriver` | `src/core/email/drivers/smtp.driver.ts` | `features.email.provider === "smtp"` and `SMTP_HOST` is set. Wraps Nodemailer with a connection pool + 10 s timeouts. |
| `BrevoEmailDriver` | `src/core/email/drivers/brevo.driver.ts` | `features.email.provider === "brevo"` and `BREVO_API_KEY` is set. Pure-`fetch` HTTP client against `https://api.brevo.com/v3/smtp/email`. Also exposes `listTemplates()` / `getTemplate()` for the Issue #9 read-only Dev-Hub tab. |
| `LogOnlyEmailDriver` | `src/core/email/email.module.ts` | `features.email.enabled === false` or no relay configured at all (offline dev). Mails go to Pino log lines instead of out the wire. |

The driver-selection planner `selectEmailDriver()` picks `primary` +
optional `transactional` from features + env. With `provider="smtp"`
and `BREVO_API_KEY` set, Brevo is wired *only* as the transactional
driver — `EmailService.sendTemplate({ brevoTemplateId })` then reaches
Brevo while plain `EmailService.send(...)` keeps using SMTP.

### Local-dev loop

`docker compose up -d mailpit` starts a Mailpit container on
`localhost:1025` (SMTP) and `localhost:8025` (web inbox). The default
`.env.example` already points `SMTP_HOST/PORT` at it, so the very
first `EmailService.send(...)` lands visibly in
[`http://localhost:8025`](http://localhost:8025) without any extra
configuration.

Two compatibility flags matter:

- `SmtpEmailDriver` sets `allowInternalNetworkInterfaces: true` because
  Nodemailer ≥ 7 blocks loopback / private addresses by default
  (SSRF guard).
- The Mailpit container is started with `--smtp-disable-rdns` because
  Mailpit's reverse-DNS lookup of the connecting client IP blocks the
  greeting for ~5 s on Docker bridge networks (no PTR records).

### Brevo setup

1. Create an API key at <https://app.brevo.com/settings/keys/api>.
2. Set `BREVO_API_KEY=xkeysib-...` in `.env`.
3. Either flip `FEATURE_EMAIL_PROVIDER=brevo` to make Brevo the
   primary, or keep `provider=smtp` and use Brevo only for templates
   via `sendTemplate({ brevoTemplateId })`.
4. Templates created in the Brevo UI become callable by ID; the
   read-only Dev-Hub tab (Issue #9) lists them via
   `BrevoEmailDriver.listTemplates()`.

Outbox-style retry / DLQ / bounce handling is a separate slice
(Issue #11) — the drivers themselves return success/failure for a
single attempt and let the outbox decide what to do next.

## Dev-Portal-Frontend

Every developer-facing HTML surface — `/dev/*`, `/admin/*`, `/errors`,
`/api/openapi` — is served by a single React 19 single-page app.
The legacy server-rendered `*-ui.ts` renderers were deleted; the SPA
is the canonical UI for every developer route. `/dev/*` and
`/admin/*` are developer-only (every route 404s outside
`NODE_ENV=development`); `/errors` and `/api/openapi` stay reachable
in any environment because frontends + SDK generators read them.

| Aspect | Path | Purpose |
|---|---|---|
| Shell renderer (planner) | `src/core/dx/dev-portal-shell.ts` | Pure function: title + script URL + token CSS URL → static HTML5 skeleton with `<div id="root">` |
| SPA source tree | `src/core/dx/clients/` | Browser-only: `main.tsx` (entry), `App.tsx` (router), `layout/`, `pages/`, `components/`, `lib/`, `styles/` |
| Layout shell | `src/core/dx/clients/layout/AdminShell.tsx` + `nav.ts` + `icons.tsx` | Sidebar + header + SVG icons + active-state highlight |
| Pages | `src/core/dx/clients/pages/` | One component per route: `DevHubLandingPage`, `FeaturesPage`, `CoveragePage`, `TestsPage`, `DiagnosticsPage`, `LogsPage`, `TracesPage`, `QueriesPage`, `RoutesPage`, `ErdPage`, `EmailPreviewPage`, `PostgrestParsePage`, `ComponentShowcasePage`, `PermissionTesterPage`, `WebhookInspectorPage`, `RealtimeInspectorPage`, `AuditBrowserPage`, `SearchTesterPage`, `ErrorsPage`, `OpenApiPage` — each lazy-loaded via `React.lazy` |
| Component library | `src/core/dx/clients/components/` | `react-aria-components` wrappers — Button, TextField, NumberField, Switch, Checkbox, RadioGroup, Select, Combobox, DialogModal, Tabs, Menu, Tooltip, FileTrigger, Toast — plus a `JsonViewer` reused by `/errors`, `/api/openapi`, and `/dev/postgrest-parse` |
| Design tokens | `src/core/dx/clients/styles/tokens.css` | `:root` custom properties (electric-lime accent, near-black surfaces) |
| Page chrome CSS | `src/core/dx/clients/styles/admin-layout.css` | Shell + every per-page CSS block; React JSX re-uses the same classnames the legacy renderers produced so the diff vs. the historical HTML is zero |
| Component styles | `src/core/dx/clients/styles/components.css` | `.dp-*` selectors targeting `react-aria` `data-*` states (input primitives only) |
| Build script | `scripts/build-dev-portal.ts` | `Bun.build({ target: "browser", splitting: true, minify: true })` → `dist/dev-portal/` |
| `/dev/*` JSON sidecars | `dev-hub.controller.ts` | `dashboard.json`, `feature-catalog.json`, `coverage.json`, `tests.json`, `diagnostics.json`, `logs.json`, `traces.json`, `queries.json`, `routes.json`, `erd.json`, `email-preview.json`, `email-builder/templates.json`, `email-builder/blocks.json`, `migrations.json` |
| `/dev/email-builder/*` mutating endpoints | `dev-hub.controller.ts` + `src/core/email/email-builder.ts` | `preview.json` (POST — render draft), `save` (POST — codegen `.tsx` to `src/modules/email/templates/`); defense-in-depth path validation, 404 outside development |
| `/dev/migrations/*` mutating endpoints | `dev-hub.controller.ts` + `migrations/migrations.service.ts` | `deploy`, `apply-one`, `dry-run`, `retry`, `create`, `apply-draft`, `draft/:name` (DELETE) — Postgres advisory-lock-gated, 404 outside development |
| `/admin/*` JSON sidecars | `admin-spa.controller.ts` | `permissions/test.json`, `webhooks.json`, `realtime.json`, `realtime/channels.json`, `audit.json`, `search.json` |
| `/admin/*` POST actions | `admin-spa.controller.ts` | `realtime/sockets/:id/disconnect`, `realtime/sockets/:id/send`, `realtime/events/replay` — all dev-only, all 404 in production |
| Static asset endpoint | `GET /dev/static/:filename` | 404 outside development; allow-list filename, MIME-detect, stream from `dist/dev-portal/` |
| Catch-all | `GET /dev/*splat` | Returns the SPA shell so client-side routes work without a server change |
| Server tsconfig | `tsconfig.json` (excludes `src/core/dx/clients/**`) | Server build never sees browser code |
| Client tsconfig | `tsconfig.client.json` | `jsx: "react-jsx"`, `lib: ["ES2022","DOM","DOM.Iterable"]`, `types: []` |

### Build & dev-loop

- `bun run build:dev-portal` produces `dist/dev-portal/main.js` (+
  code-split chunks + `main.css` + `tokens.css`). Bundle budget: ≤ 400
  KB gzipped for the Base-SPA (no Monaco, no TipTap). Current size:
  ~116 KB initial / ~261 KB total (all chunks) gzipped.
- `bun run dev` runs an awaited initial portal build *before* the API
  child spawns, then starts `bun run build:dev-portal --watch` for
  incremental rebuilds (~80 ms warm). This eliminates the startup
  race where a request to `/dev/static/main.js` could hit a missing
  bundle.
- `bun run setup` builds the SPA once after `bun install` so
  `/dev/static/main.js` exists before the first dev start.

### Coverage

`src/core/dx/clients/**` is **excluded** from the ≥ 70 % core
coverage threshold (see `vitest.config.ts`). UI glue is exercised
manually in development and by future Chrome-DevTools-MCP smoke
tests; the **shell renderer** keeps a story test
(`tests/stories/dev-portal-shell.story.test.ts`) because it crosses
the trust boundary (server → browser).

### Conventions

- **Native HTML inputs in net-new pages are forbidden.** Every
  interactive primitive on a brand-new page goes through
  `react-aria-components` via the wrappers in `components/`. The
  remaining admin-page ports (e.g. `AuditBrowserPage`) intentionally
  render bare `<input>` / `<select>` inside `form.admin-form` because
  the legacy CSS targets those selectors — swapping them for `dp-*`
  wrappers would break the byte-for-byte fidelity contract with the
  historical server pages. The Webhook-Inspector is the first page to
  fully adopt the `dp-*` wrappers (issue #19).
- **No `process.env.*` / Node imports.** This tree is browser-only;
  `tsconfig.client.json` excludes Node types so this fails at compile
  time.
- **No server-rendered HTML left.** Every `Controller` returning HTML
  returns the dev-portal SPA shell; React + react-router decide what
  to render based on the URL.

## Security mechanisms (overview)

| Layer | Mechanism |
|---|---|
| Network | TLS via reverse proxy, HSTS |
| Boot | ENV validation (Zod), `assertCookiesProductionSafe()`, fail-fast |
| CORS | Auto-derived from `BASE_URL`/`APP_URL`; opt-in `allowedOrigins[]` |
| Cookies | httpOnly, Secure, SameSite=Lax (default), signed |
| Auth | Better-Auth (sessions + JWT), 2FA, Passkey, rate-limit, brute-force lockout |
| API keys | argon2id hash, scopes, expiry, revocation |
| AuthZ | CASL + DB rules, field-level + item-level, presets, validation |
| Output | 4-stage pipeline, secret safety net |
| Field encryption | AES-256-GCM, key versioning, optional blind-index |
| Webhooks | HMAC-SHA256, replay protection, auto-disable |
| Realtime | Permission-aware rooms, auth handshake |
| Mobile sync | Sync rules ⊆ READ permissions, JWT audience validation |
| Tenant isolation | App layer + RLS |
| Input | Zod pipe, mime-magic-byte for files |
| DB | RLS, FK with `ON DELETE`, soft-delete |
| Files | Mime allowlist, magic-byte, path-traversal guards, signed URLs |
| Logging | Pino + OTel, W3C trace context, no PII in logs |
| Rate limit | `@nestjs/throttler` + Postgres store, multi-window |
| Headers | Helmet (HSTS, X-Content-Type-Options, X-Frame-Options, CSP) |
| Idempotency | `Idempotency-Key` header, 24h cache |
| Concurrency | `ETag` / `If-Match` |
| Errors | RFC 7807 (`application/problem+json`) |
| Secrets | Never in code; Better-Auth secret 32+ chars; rotation supported |
| Dependencies | `bun audit` gate in CI, Renovate |

## Initial data model

```
Auth        User · Account · Session · VerificationToken · TwoFactor · Passkey · Jwks · ApiKey
Tenancy     Tenant · TenantMember
Permission  Role · Policy · RolePolicy · Permission
Files       FileFolder · File · FileBlob · AssetPreset
Webhooks    WebhookEndpoint · WebhookDelivery
Realtime    RealtimeSubscription                       (optional)
Geo         Address · Geofence · GeocodingCache         (optional, PostGIS)
Mobile      PowerSyncDevice                            (optional)
Reliability AuditLog · OutboxEvent · IdempotencyKey
System      ScheduledJob
```

Schemas in `prisma/schema.prisma` (always present) and
`prisma/features/<feature>.prisma` (concatenated by
`bun run prepare:schema` based on `features.ts`).

## Where to read more

- Coding conventions → [`code-guidelines.md`](./code-guidelines.md)
- How to contribute → [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
- Project-specific code → [`customization-guide.md`](./customization-guide.md)
- Public-surface stability → [`api-stability-promise.md`](./api-stability-promise.md)
- Upstream PR workflow → [`core-contribution-guide.md`](./core-contribution-guide.md)
- Template sync → [`template-update-workflow.md`](./template-update-workflow.md)
- Webhook contract → [`webhook-spec.md`](./webhook-spec.md)
- Working with AI agents → [`working-with-ai-agents.md`](./working-with-ai-agents.md)
