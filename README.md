<div align="center">

# nest-base

### NestJS · Bun · Prisma · Postgres · Better-Auth

**A production-grade NestJS starter that ships with a developer cockpit you'll actually want to use.**

Pure-black dark theme. Electric-lime accent. Live status, coverage, tests, logs, feature toggles — all in one screen. No cloud dependencies. No bloat.

[Quick Start](#-quick-start) · [Dev Hub](#-the-dev-hub) · [Features](#-features) · [Architecture](#-architecture) · [Testing](#-testing)

---

![Dev Hub Cockpit](docs/screenshots/dev-hub.png)

</div>

## ✦ Why this template

Most NestJS starters give you a `Hello World` and call it a day. This one ships you a server you can actually run on day one **plus** a full-blown developer cockpit at `/dev` that knows what's running, what's failing, and what's available to switch on.

- **Real cockpit, not a JSON dump** — the `/dev` dashboard pulls live health, coverage, test summary, log tail, feature matrix, and service status into one view.
- **Toggle features from the UI** — no `.env` editing dance: flip a feature on, the server restarts, the page reloads. 14 toggleable features ship with sensible defaults.
- **Template-owned core** — `src/core/` is the synced template surface, `src/modules/` is yours. Pull upstream improvements without losing your domain code.
- **Battle-tested defaults** — Postgres RLS multi-tenancy, ETag concurrency, idempotency keys, RFC 7807 errors, AES-256-GCM field encryption, OpenAPI 3.1, OWASP-aligned headers.
- **No proprietary tooling** — pino-pretty for terminal logs, JSON-Viewer for any JSON endpoint, Scalar for the API reference, Prisma Studio for the DB. Everything self-hosted.

---

## ⚡ Quick Start

**Prerequisites:** [Bun](https://bun.sh) 1.x · Docker Desktop · macOS / Linux

```bash
# 1. Install dependencies
bun install

# 2. (optional, if you forked the template) Rename to your project name
bun run rename my-app

# 3. Generate .env with strong random secrets (creates .env.example too if missing)
bun run setup

# 4. Generate Prisma client + run migrations
bun run prisma:generate
bun run prisma:migrate

# 5. (optional) Insert demo data — 2 tenants, 6 users, sample records
bun run seed

# 6. (optional) Verify everything is wired correctly
bun run onboard          # quick sanity check (Bun / .env / Postgres / Prisma)
bun run doctor           # deep health check (containers, services, secrets, disk)

# 7. Start the dev server — boots Postgres if needed, opens the Dev Hub
bun run dev
```

> **`bun run rename <name>`** patches `package.json`, `README.md`, `portless.yml`, and `docker-compose.yml` in one shot. Idempotent — safe to run repeatedly.
>
> **`bun run reset`** wipes the DB, replays every migration, and re-seeds — one command for "give me a clean slate". Refuses on production and non-local DATABASE_URL hosts as defense-in-depth.
>
> **Re-running `bun run setup` after a prior boot?** Delete `.env` first, then re-run setup, then run `docker compose down -v && docker compose up -d` to discard the old Postgres volume — otherwise `bun run prisma:migrate` fails with `P1000` because the volume still holds the previous password.

The Dev Hub opens automatically at the URL the dev runner prints — `https://api.<project>.localhost/dev` if you use [portless](https://github.com/portless/portless), otherwise the bare `http://localhost:<port>/dev`. The runner picks `:3000` when free and falls back to a dynamic port (e.g. `:4266`) when it isn't, so always trust the printed URL over a hard-coded `:3000`.

> **What `bun run dev` does for you**: starts Postgres via `docker compose up -d postgres` if the container isn't running, spawns Prisma Studio on `:5555`, watches `.env` for changes (so feature toggles take effect without a manual restart), and opens the Dev Hub in your browser. Set `NO_OPEN=1` to skip the auto-open, `SKIP_DB_BOOT=1` to skip the Postgres boot.
>
> **Need a public URL?** `bun run dev --tunnel` exposes `localhost:<port>` to the internet via Cloudflare Tunnel — handy for testing webhook receivers (Stripe, GitHub, Slack, OAuth callbacks) without deploying. Requires `cloudflared` (`brew install cloudflared`). See [`docs/dev-tunnel.md`](./docs/dev-tunnel.md).
>
> **`bun run onboard`** is the lightweight first-run check (Bun version, `.env` presence, Postgres TCP reachability, Prisma client). **`bun run doctor`** goes deeper: container statuses, env-var entropy, disk space, configurable services. JSON output via `bun run doctor --json` for CI consumption.

---

## 🎯 The Dev Hub

A black + lime developer console powered by a React 19 SPA (`src/core/dx/clients/`). Every developer-facing page — `/dev/*`, `/admin/*`, `/errors`, `/api/openapi` — is rendered by the same shell; the Nest controllers return JSON sidecars + the SPA shell, the SPA decides which page to mount. Every page is reachable from the sidebar.

### Cockpit Dashboard — `/dev`

Live overview of the running server: health verdict, uptime, heap, 4 stat tiles (Coverage / Tests / Features / Logs), service probes, log preview, feature matrix, quick navigation.

![Dev Hub Cockpit](docs/screenshots/dev-hub.png)

### Feature Toggles — `/dev/features`

14 feature flags grouped by category. Each card shows description, exposed surfaces, and the matching `FEATURE_*` env-var. **Flip the switch → `.env` is patched → server respawns → page reloads.** No manual restarts.

![Feature Toggles](docs/screenshots/features.png)

### Brand — `/dev/brand`

Single-file brand config (`src/modules/branding/brand.json`, with template default at `src/core/branding/brand.default.json`) drives every Dev-Portal CSS variable, the OpenAPI title, the email layouts (`Barebone` + EJS legacy), the Better-Auth issuer/RP-name, and the `EmailService` default `From:`. Edit via the UI, save, the dev runner restarts the API, every surface picks up the new look. Schema-validated hex colors + email + URL — bad input fails at load time, not at next mail send. See [docs/customization-guide.md#branding](docs/customization-guide.md#branding).

### Test Summary — `/dev/tests`

Reads `coverage/test-summary.json` (populated by `bun run test:summary`). Failed suites floated to the top with embedded failure snippets.

![Tests](docs/screenshots/tests.png)

### Coverage Report — `/dev/coverage`

Reads `coverage/coverage-summary.json` (populated by `bun run test:coverage`). Per-tier gate badges (core ≥ 90% / modules ≥ 80%), per-file table sorted worst-first.

![Coverage](docs/screenshots/coverage.png)

### Live Log Tail — `/dev/logs`

In-memory ring buffer of the last 500 Pino records. Auto-polls every 2 seconds. Level chips (info / warn / error / fatal) with subtle color tints.

![Logs](docs/screenshots/logs.png)

### Diagnostics — `/dev/diagnostics`

Heap usage bar (turns warn/bad above 70%/90%, clamped to 100% — Bun's JSC heap accounting can briefly show used > committed and that's not a leak), versions (Node, Bun, platform), active features matrix, app metadata.

![Diagnostics](docs/screenshots/diagnostics.png)

### Live Request Traces — `/dev/traces`

In-memory ring buffer (200 entries) of recent HTTP request traces with method, status, duration, and request-id. Bound-height container with sticky header, polled every 2 s — newest entries flash in at the top. **Click a row** to inline-expand the DB queries that ran during that request (cross-references `/dev/queries` via `requestId`).

### DB Query Performance — `/dev/queries`

Every Prisma query event lands in a 500-entry ring buffer. The page surfaces:
- the **slowest 10 queries** colour-coded against thresholds (warn > 50 ms, critical > 200 ms),
- the **most frequent SQL templates** — a cheap N+1 detector (literals collapsed via `normaliseSql()`, count ≥ 10 highlighted),
- a tail of the most recent 100 queries,
- 4-tile summary (total · slow · critical · slowest).

If a slice you just shipped lands in the slowest section, that's your next thing to fix.

### Jobs Dashboard — `/dev/jobs`

Two-tab view of the in-memory `JobQueueService` (the future pg-boss adapter exposes the same JSON contract):

- **Queues** — per-queue counts, p95 latency, failure rate. Click a queue to filter the Jobs tab.
- **Jobs** — paginated, queue + state filterable list. Inspect opens a drawer with the full payload (rendered in the JSON viewer), the captured error stack on failed jobs, and a Retry button that POSTs to `/dev/jobs/jobs/:id/retry` and re-enqueues a failed job with a bumped attempt counter.

Pure planner (`buildJobAggregates()`) computes counts / p95 / failure-rate over a flat `JobRecord` list, so the same dashboard renders unchanged once a Postgres-backed adapter ships. Auto-refresh every 4 s. Schedules / Workers / Archive tabs are deferred to the pg-boss adapter slice.

### Routes Inventory — `/dev/routes`

Live audit of every endpoint registered in NestJS, with its decorator-derived guard kind: `@Can(action, subject)` (guarded), `public` (allowlist), `dev-only` (404s in prod), or `unguarded` (red). 5-tile summary with per-kind counts so an auditor can spot gaps. JSON endpoint at `/dev/routes.json` for SDK / agent tooling.

### Prisma ERD — `/dev/erd`

Live Mermaid `erDiagram` of the active Prisma schema (concat'd from `schema.prisma` + `prisma/features/*.prisma`). One-to-many vs many-to-many relations inferred from list-typed fields. Toggle source / copy Mermaid buttons.

### Email Preview — `/dev/email-preview`

Every registered email template rendered with a realistic sample payload. Subject + sandboxed HTML iframe + plain-text version side-by-side, plus the sample-payload JSON. Mailpit at `:8025` shows actually-sent emails; this page is for "did my edit to the welcome template break anything?".

### Email Outbox — `/dev/outbox.json`

JSON snapshot of the email-outbox subsystem (issue #11 — at-least-once delivery). Shows the lag classification (pending count, oldest age, threshold) plus the 100 most-recent dispatchable rows. Better-Auth hooks (verify / reset / welcome / invitation) enqueue via the outbox by default with a deterministic idempotency-key (recipient + token), so a "click resend twice" collapses into one row and a server crash between trigger and SMTP-ACK never loses a verification mail. Worker tick is configurable via `EMAIL_OUTBOX_TICK_MS` (default 1s); records that fail transiently retry with exponential backoff (1m → 5m → 25m, 2h cap, 5 attempts) before graduating to `dead-letter`. The `/health/ready` probe trips to 503 when lag exceeds 30s.

### Migrations — `/dev/migrations`

Five-tab handler for Prisma schema evolution: **Status** (rows from `_prisma_migrations` with retry on failed), **Pending** (preview SQL · apply one · apply all · dry-run in a transaction), **Diff** (`prisma migrate diff` between live DB and `schema.prisma`), **History** (timeline of applied migrations), **Create New** (kebab-case validated → `prisma migrate dev --create-only` → SQL preview → apply or discard). Drift banner above all tabs. Every mutating endpoint is gated by a Postgres advisory lock (409 on contention) and 404s outside `NODE_ENV=development`.

### JSON Endpoints — `/errors`, `/api/openapi`, `/dev/postgrest-parse`

Every JSON endpoint has a sister HTML page that mounts the React SPA's shared **JSON viewer** — syntax-highlighted, collapsible tree, copy button, key-filter search. Browser default → viewer; `Accept: application/json` or `?format=json` → raw JSON for SDKs.

![Error Catalog](docs/screenshots/errors.png)
![OpenAPI Viewer](docs/screenshots/openapi.png)

### API Reference — `/api/docs`

[Scalar](https://scalar.com) renders the OpenAPI 3.1 spec with try-it-out. The raw JSON sits at `/api/openapi.json` for [kubb](https://kubb.dev) SDK generation.

### Admin Tools — `/admin/*`

Permission tester, audit browser, search tester, webhook inspector, realtime inspector. All in the same dark-mode shell with consistent navigation.

The realtime inspector at `/admin/realtime` ships with three tabs (Sockets / Channels / Events), per-socket disconnect / send-event actions, payload-replay, and a 1.5 s React-Query poll so the live snapshot reflects every gateway lifecycle change without a page reload. Payloads are PII-masked and the surface 404s outside `NODE_ENV=development`.

![Permission Tester](docs/screenshots/permission-tester.png)

---

## 🧱 Features

| Category | Feature | Default | ENV Toggle |
|---|---|---|---|
| **Infrastructure** | Multi-Tenancy (`x-tenant-id` + RLS) | ✓ | `FEATURE_MULTI_TENANCY_ENABLED` |
| | Rate Limiting (multi-window, Postgres) | ✓ | `FEATURE_RATE_LIMIT_ENABLED` |
| | Idempotency (Stripe-style `Idempotency-Key`) | ✓ | `FEATURE_IDEMPOTENCY_ENABLED` |
| | Background Jobs (in-memory, pg-boss-ready) | ✓ | `FEATURE_JOBS_ENABLED` |
| **Data** | Files & TUS Uploads (S3 / local / postgres) | ✓ | `FEATURE_FILES_ENABLED` |
| | Asset transforms via IPX (Nuxt-Image-compatible `/_ipx/*`) | ✓ | follows `FEATURE_FILES_ENABLED` |
| | Full-Text Search (Postgres FTS) | ✗ | `FEATURE_SEARCH_ENABLED` |
| | PowerSync (offline-first) | ✗ | `FEATURE_POWERSYNC_ENABLED` |
| | Field Encryption (AES-256-GCM) | ✗ | `FEATURE_FIELD_ENCRYPTION_ENABLED` |
| | Geo / Places (geocoding cache) | ✗ | `FEATURE_GEO_ENABLED` |
| | GeoIP (offline IP→country/city via .mmdb) | ✗ | `FEATURE_GEO_IP_ENABLED` |
| **Communication** | Email (Nodemailer + Brevo) | ✓ | `FEATURE_EMAIL_ENABLED` |
| | Realtime (LISTEN/NOTIFY + Socket.IO) | ✗ | `FEATURE_REALTIME_ENABLED` |
| **Integration** | Webhooks (HMAC-signed + retry) | ✗ | `FEATURE_WEBHOOKS_ENABLED` |
| | Model Context Protocol (MCP) | ✗ | `FEATURE_MCP_ENABLED` |
| **Observability** | OpenTelemetry + Pino logs | ✓ | `FEATURE_OBSERVABILITY_ENABLED` |

Each toggleable feature drives module imports, controller registration, and middleware wiring conditionally. Disabled features have **zero runtime cost** — no providers, no routes, no startup time.

---

## 🏛 Architecture

```
src/
├── core/                ← Template-owned. Synced via `bun run sync:from-template`.
│   ├── app/             ← Bootstrap + AppModule + dev-tab auto-open
│   ├── auth/            ← Better-Auth wiring + API keys + PowerSync JWT
│   ├── concurrency/     ← ETag + If-Match optimistic concurrency
│   ├── dx/              ← /dev + /admin + /errors + /api/openapi (React SPA shell + JSON sidecars)
│   ├── email/           ← EmailService + EJS templates
│   ├── encryption/      ← AES-256-GCM field encryption
│   ├── errors/          ← CORE_* error codes + RFC 7807 filter
│   ├── features/        ← FeaturesSchema (Zod) — single source of truth
│   ├── files/           ← TUS uploads + storage adapters
│   ├── multi-tenancy/   ← Tenant guard + RLS helpers
│   ├── observability/   ← OTel + Pino + traceparent middleware
│   ├── output-pipeline/ ← 4-stage permission/secret-filter
│   ├── permissions/     ← CASL ability + DB-rule resolver + admin CRUD
│   ├── prisma/          ← PrismaService + driver-adapter
│   ├── realtime/        ← LISTEN/NOTIFY + Socket.IO gateway
│   ├── search/          ← FTS query parser + cross-resource search
│   └── webhooks/        ← HMAC + retry-policy + dispatcher
├── modules/             ← Project-owned. Add your domain here.
└── shared/              ← Cross-tier types (channels, event payloads, SDK seeds).
```

**Conventions:** ESM with `.js` import suffixes (TypeScript `nodenext`). Pure-planner / thin-runner split — every helper that touches I/O has a pure planner + a thin glue layer. Named error sentinels mapped to RFC 7807 by the global filter.

The architectural rationale lives in [`docs/architecture.md`](./docs/architecture.md), the coding conventions in [`docs/code-guidelines.md`](./docs/code-guidelines.md), the agent-readable orientation in [`CLAUDE.md`](./CLAUDE.md).

---

## 🧪 Testing

| Command | What it does | Threshold |
|---|---|---|
| `bun run test:unit` | Pure-function tests (`tests/unit/`) | — |
| `bun run test:e2e` | Story tests + HTTP e2e (`tests/stories/`, `tests/*.e2e-spec.ts`) | — |
| `bun run test:types` | TypeScript compile checks (`tests/types/`) | — |
| `bun run test:coverage` | Vitest + V8 coverage report | core ≥ 80% lines · modules ≥ 75% lines |
| `bun run test:summary` | Vitest JSON reporter → `/dev/tests` page | — |

**Discipline:** strict red-green-refactor TDD — every behaviour change starts as a failing test. The 6 quality gates (`lint`, `format`, `test:types`, `test:unit`, `test:e2e`, `test:coverage`, `build`) gate every commit.

Currently **1712 tests** across 194 files. Coverage 95.48% lines (well above the 80% gate). Lines are the headline metric; statements / functions / branches are tuned looser since defensive runtime guards inflate them without representing real risk — see `src/core/testing/coverage-gate.ts`.

---

## 🔌 Tech Stack

| | |
|---|---|
| Runtime | [Bun](https://bun.sh) 1.x (Node 22 fallback) |
| Framework | [NestJS 11](https://nestjs.com) |
| ORM | [Prisma 7](https://prisma.io) (driver-adapter mode) |
| Database | Postgres 18 (`pg_uuidv7` for UUID v7 IDs) |
| Auth | [Better-Auth 1.6](https://better-auth.com) — email/password, social providers, passkeys, 2FA, API keys |
| Validation | [Zod 4](https://zod.dev) |
| Tests | [Vitest 4](https://vitest.dev) + [Testcontainers](https://testcontainers.com) |
| Lint / Format | [oxlint](https://oxc.rs) / [oxfmt](https://oxc.rs) — Rust-fast tooling |
| API Docs | [Scalar](https://scalar.com) (UI) + [@nestjs/swagger](https://docs.nestjs.com/openapi/introduction) (spec) |
| SDK Generation | [kubb](https://kubb.dev) |
| Observability | [Pino](https://getpino.io) + [OpenTelemetry](https://opentelemetry.io) |
| Container | Docker Compose (Postgres, Mailpit, RustFS, OTel collector) |

---

## 🛠 Useful Scripts

```bash
# Development
bun run dev                   # Dev server + Prisma Studio + auto-open Dev Hub
bun run dev --tunnel          # …same, plus a public Cloudflare-Tunnel URL
bun run lint                  # oxlint (95 rules, 30ms)
bun run format                # oxfmt --check
bun run format:fix            # oxfmt
bun run build                 # Bundle to dist/

# Testing
bun run test:unit             # Unit tests
bun run test:e2e              # E2E + story tests
bun run test:types            # tsc --noEmit
bun run test:coverage         # V8 coverage with gate
bun run test:summary          # JSON reporter for /dev/tests

# Schema
bun run prepare:schema        # Concat feature schemas → schema.generated.prisma
bun run prisma:generate       # Generate Prisma client
bun run prisma:migrate        # Apply migrations

# Project lifecycle
bun run setup                 # Generate .env with strong random secrets (idempotent)
bun run onboard               # First-run sanity check (Bun / .env / Postgres-TCP / Prisma)
bun run doctor                # Comprehensive health check (containers, services, secrets,
                              # disk space, env strength) — JSON output for CI via --json
bun run rename <new-name>     # Rename project across the codebase
bun run reset                 # Wipe DB → migrate → seed in one shot (refuses on prod /
                              # non-local DATABASE_URL hosts as defense-in-depth)
bun run seed                  # Insert deterministic demo data (2 tenants, 6 users, roles)
bun run sync:from-template    # Pull latest src/core/ from upstream
bun run sync:to-template      # Contribute changes back upstream
bun run sdk:generate          # kubb → typed SDK from /api/openapi.json
```

---

## 🔧 Environment Variables

The setup wizard (`bun run setup`) generates a `.env` from `.env.example` with strong secrets. Key vars:

```dotenv
NODE_ENV=development
PORT=3000
APP_BASE_URL=https://api.your-project.localhost   # or http://localhost:3000

DATABASE_URL=postgresql://user:pass@localhost:5432/db
BETTER_AUTH_SECRET=<32 bytes>

# Optional but useful in dev
MAILPIT_WEB_URL=http://localhost:8025
POWERSYNC_URL=http://localhost:8080

# Dev Hub controls
NO_OPEN=1                     # Skip browser auto-open
PRISMA_STUDIO=0               # Skip Prisma Studio sibling spawn
DISABLE_PORTLESS=1            # Force http://localhost:<port>

# Feature toggles (all 14 listed via /dev/features)
FEATURE_WEBHOOKS_ENABLED=true
FEATURE_REALTIME_ENABLED=true
# ...
```

---

## 🤖 AI-driven Development

This project is **optimised for AI-assisted development** with [Claude Code](https://claude.com/claude-code) — every convention, test pattern, and dev-hub page exists with an AI agent as a first-class user.

```bash
# Slash commands ship with the repo
/add-module <name>              # New project resource (controller / service / DTO / tests)
/add-feature <key> "<desc>"     # Toggleable feature flag end-to-end
/add-page <slug> "<title>"      # New /dev or /admin page in the dark-mode shell
/upstream-pr                    # PR a src/core/ fix back to nest-base (downstream projects)
```

**Skills** — procedural how-tos that encode the project's conventions so every agent does the right thing the first time:

| Skill | Use it when |
|---|---|
| `understanding-the-architecture` | First contact — mental model in 200 lines |
| `avoiding-common-pitfalls` | Catalogue of every place this codebase will burn you |
| `writing-story-tests` | TDD pattern for `tests/stories/*.story.test.ts` |
| `running-tdd-slice` | Red-green-refactor cycle for one behaviour change |
| `working-with-prisma` | Prisma 7 + driver-adapter mode |
| `writing-migrations` | Schema → prepare → migrate → RLS pattern |
| `wiring-permissions` | Add CASL ability checks to a handler |
| `debugging-permission-denials` | 5-step diagnostic path: 403 → log → tester → DB rules → regression test |
| `adding-feature-flag` | New toggleable feature, end-to-end |
| `adding-feature-module` | Scaffold a feature module under `src/modules/` |
| `adding-error-code` | New `CORE_*` error code with i18n |
| `extending-dev-hub` | New dev-hub or admin page in the shared shell |
| `syncing-from-template` | Pull `src/core/` updates from upstream |
| `contributing-upstream` | When and how to PR a fix back to `nest-base` |

A fresh agent reads [`.claude/QUICKSTART.md`](./.claude/QUICKSTART.md) (60 sec) → [`.claude/AGENTS.md`](./.claude/AGENTS.md) (lookup table) → the matching skill, and is productive in under 3 minutes. Six quality gates per commit ensure the agent can't ship a regression.

**Two-way sync flow** — when Claude in a downstream project fixes a bug in `src/core/` or builds a generic capability, it offers to open a PR back to **nest-base** automatically. Generic improvements flow upstream so every consumer benefits on their next `bun run sync:from-template`. See [`.claude/skills/contributing-upstream.md`](./.claude/skills/contributing-upstream.md).

**Test-ability hatch** — e2e specs that hit a `@Can()`-gated route can pre-seed an admin Ability via the `X-Test-Ability: full` header instead of driving the full Better-Auth sign-in flow. Honoured only when `NODE_ENV=test` (strict no-op in production). See `src/core/permissions/test-ability.ts`.

→ Full guide: [`docs/working-with-ai-agents.md`](./docs/working-with-ai-agents.md).

---

## 📚 Documentation

**Getting started**
- [`docs/working-with-ai-agents.md`](./docs/working-with-ai-agents.md) — AI-driven development workflow (Claude Code, slash commands, skills)
- [`docs/consumer-guide.md`](./docs/consumer-guide.md) — bootstrapping a new project on this template
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — TDD discipline, six gates, PR rituals

**Reference**
- [`docs/architecture.md`](./docs/architecture.md) — module overview, permission model, output pipeline, security layers
- [`docs/code-guidelines.md`](./docs/code-guidelines.md) — conventions a quick scan won't teach you
- [`CLAUDE.md`](./CLAUDE.md) — agent-readable orientation
- [`.claude/AGENTS.md`](./.claude/AGENTS.md) — full agent / skill / command catalogue
- [`docs/api-stability-promise.md`](./docs/api-stability-promise.md) — semver + deprecation rules
- [`docs/webhook-spec.md`](./docs/webhook-spec.md) — outbound webhook contract
- [`docs/initialisation-history.md`](./docs/initialisation-history.md) — historical record of the eight-phase bootstrap

**Workflows**
- [`docs/template-update-workflow.md`](./docs/template-update-workflow.md) — pulling upstream changes
- [`docs/customization-guide.md`](./docs/customization-guide.md) — adding domain modules in `src/modules/`
- [`docs/core-contribution-guide.md`](./docs/core-contribution-guide.md) — contributing back to `src/core/`

**Community**
- [`SECURITY.md`](./SECURITY.md) — vulnerability disclosure
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — community standards

---

## 📜 License

MIT — see [`LICENSE`](./LICENSE).

### Third-party data attribution

The GeoIP feature reads `.mmdb` files produced by the configured
provider. The data is **not** redistributed with this template — each
deployment downloads its own copy at install time — but using it
imposes the provider's terms.

- **dbip-lite** (default): IP-to-City Lite database © db-ip.com.
  Distributed under the
  [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).
  When you ship a product surface that exposes geo-derived data
  (e.g. "login from Berlin" e-mails), credit "IP geolocation by
  [db-ip.com](https://db-ip.com)" somewhere accessible to end users
  (privacy notice or settings page is fine).
- **MaxMind GeoLite2** (opt-in): subject to the
  [MaxMind GeoLite2 EULA](https://www.maxmind.com/en/geolite2/eula).
  Free signup + license key required; downloads track the requesting
  IP. Pick `dbip-lite` for Schrems-II-strict deployments.

---

<div align="center">
<sub>Built with the discipline of strict TDD, the rigor of six quality gates per commit, and the joy of a dev hub that actually <strong>knallt</strong>.</sub>
</div>
