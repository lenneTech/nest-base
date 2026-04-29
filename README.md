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

# 2. Generate .env with strong random secrets (creates .env.example too if missing)
bun run setup

# 3. Generate Prisma client + run migrations
bun run prisma:generate
bun run prisma:migrate

# 4. (optional) Verify everything is wired correctly
bun run onboard

# 5. Start the dev server — boots Postgres if needed, opens the Dev Hub
bun run dev
```

The Dev Hub opens automatically at **http://localhost:3000/dev** (or `https://api.<project>.localhost/dev` if you use [portless](https://github.com/portless/portless)).

> **What `bun run dev` does for you**: starts Postgres via `docker compose up -d postgres` if the container isn't running, spawns Prisma Studio on `:5555`, watches `.env` for changes (so feature toggles take effect without a manual restart), and opens the Dev Hub in your browser. Set `NO_OPEN=1` to skip the auto-open, `SKIP_DB_BOOT=1` to skip the Postgres boot.

> **`bun run onboard` is a sanity check**: prints a structured report of Bun version, `.env` presence, Postgres reachability, and Prisma client status. Run it whenever something feels off.

---

## 🎯 The Dev Hub

A black + lime developer console rendered server-side, no SPA, no build step. Every page is reachable from the sidebar.

### Cockpit Dashboard — `/dev`

Live overview of the running server: health verdict, uptime, heap, 4 stat tiles (Coverage / Tests / Features / Logs), service probes, log preview, feature matrix, quick navigation.

![Dev Hub Cockpit](docs/screenshots/dev-hub.png)

### Feature Toggles — `/dev/features`

14 feature flags grouped by category. Each card shows description, exposed surfaces, and the matching `FEATURE_*` env-var. **Flip the switch → `.env` is patched → server respawns → page reloads.** No manual restarts.

![Feature Toggles](docs/screenshots/features.png)

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

Heap usage bar (turns warn/bad above 70%/90%), versions (Node, Bun, platform), active features matrix, app metadata.

![Diagnostics](docs/screenshots/diagnostics.png)

### JSON Endpoints — `/errors`, `/api/openapi`, `/dev/postgrest-parse`

Every JSON endpoint has a sister HTML page with a real **JSON viewer** — syntax-highlighted, collapsible tree, copy button, key-filter search. Browser default → viewer; `Accept: application/json` or `?format=json` → raw JSON for SDKs.

![Error Catalog](docs/screenshots/errors.png)
![OpenAPI Viewer](docs/screenshots/openapi.png)

### API Reference — `/api/docs`

[Scalar](https://scalar.com) renders the OpenAPI 3.1 spec with try-it-out. The raw JSON sits at `/api/openapi.json` for [kubb](https://kubb.dev) SDK generation.

### Admin Tools — `/admin/*`

Permission tester, audit browser, search tester, webhook inspector, realtime inspector. All in the same dark-mode shell with consistent navigation.

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
| | Full-Text Search (Postgres FTS) | ✗ | `FEATURE_SEARCH_ENABLED` |
| | PowerSync (offline-first) | ✗ | `FEATURE_POWERSYNC_ENABLED` |
| | Field Encryption (AES-256-GCM) | ✗ | `FEATURE_FIELD_ENCRYPTION_ENABLED` |
| | Geo / Places (geocoding cache) | ✗ | `FEATURE_GEO_ENABLED` |
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
│   ├── dx/              ← /dev landing + cockpit + JSON viewer + admin UIs
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

The full architectural rationale lives in [`PLAN.md`](./PLAN.md). The agent-readable orientation in [`CLAUDE.md`](./CLAUDE.md).

---

## 🧪 Testing

| Command | What it does | Threshold |
|---|---|---|
| `bun run test:unit` | Pure-function tests (`tests/unit/`) | — |
| `bun run test:e2e` | Story tests + HTTP e2e (`tests/stories/`, `tests/*.e2e-spec.ts`) | — |
| `bun run test:types` | TypeScript compile checks (`tests/types/`) | — |
| `bun run test:coverage` | Vitest + V8 coverage report | core ≥ 90% · modules ≥ 80% |
| `bun run test:summary` | Vitest JSON reporter → `/dev/tests` page | — |

**Discipline:** strict red-green-refactor TDD. Every PLAN.md slice is one test file → one impl → one commit. The 6 quality gates (`lint`, `format`, `test:types`, `test:unit`, `test:e2e`, `test:coverage`, `build`) gate every commit.

Currently **1396 tests** across 165 files. Coverage 95.28% lines.

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
bun run onboard               # First-run sanity check (Bun / .env / Postgres / Prisma)
bun run rename <new-name>     # Rename project across the codebase
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
```

A fresh agent reads [`.claude/QUICKSTART.md`](./.claude/QUICKSTART.md) (60 sec) → [`.claude/AGENTS.md`](./.claude/AGENTS.md) (lookup table) → the matching skill, and is productive in under 3 minutes. Six quality gates per commit ensure the agent can't ship a regression.

→ Full guide: [`docs/working-with-ai-agents.md`](./docs/working-with-ai-agents.md).

---

## 📚 Documentation

**Getting started**
- [`docs/working-with-ai-agents.md`](./docs/working-with-ai-agents.md) — AI-driven development workflow (Claude Code, slash commands, skills)
- [`docs/consumer-guide.md`](./docs/consumer-guide.md) — bootstrapping a new project on this template
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — TDD discipline, six gates, PR rituals

**Reference**
- [`PLAN.md`](./PLAN.md) — full spec with architecture rationale per module
- [`CLAUDE.md`](./CLAUDE.md) — agent-readable orientation
- [`.claude/AGENTS.md`](./.claude/AGENTS.md) — full agent / skill / command catalogue
- [`docs/api-stability-promise.md`](./docs/api-stability-promise.md) — semver + deprecation rules
- [`docs/webhook-spec.md`](./docs/webhook-spec.md) — outbound webhook contract

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

---

<div align="center">
<sub>Built with the discipline of strict TDD, the rigor of six quality gates per commit, and the joy of a dev hub that actually <strong>knallt</strong>.</sub>
</div>
