# nest-server-template

Template-style NestJS server on Bun + Prisma + Postgres + Better-Auth.
Designed as a starter for `lt fullstack init` and as the sync source
for `src/core/`.

## Stack

| Layer | Tool |
|---|---|
| Runtime | Bun 1.x (fallback: Node 22) |
| Framework | NestJS 11 |
| ORM | Prisma 7 (driver-adapter) |
| DB | Postgres 18 |
| Auth | Better-Auth |
| Validation | Zod 4 + nestjs-zod |
| Tests | Vitest + Supertest |
| Lint/Format | oxlint / oxfmt |
| SDK generation | kubb |
| Object storage | RustFS (S3 API) |
| Realtime | Socket.IO + Postgres NOTIFY |
| Job queue | pg-boss |
| File uploads (TUS) | @tus/server v3 |
| Image transform | sharp |
| CI | GitHub Actions + GitLab CI |
| Local dev routing | portless |
| License | MIT |

Full spec: [`PLAN.md`](./PLAN.md). AI agent guide:
[`CLAUDE.md`](./CLAUDE.md).

## Status

All mandatory and optional phases from PLAN.md §32 are complete
(Phase 1–8 + 5b PowerSync + 5c Geo + 6 Email/2FA/Passkey/MCP) — see
[`RALPH_LOG.md`](./RALPH_LOG.md). Test suite: 1238 tests across 133
files, coverage ≥ 96 % on `src/core/`.

## Quickstart

```bash
# 1. Install Bun (if you don't have it yet)
curl -fsSL https://bun.sh/install | bash

# 2. Bootstrap the repo — also installs portless as a devDependency
bun install

# 3. Rename the project (see "Project rename" below — only once after
#    cloning)
bun run rename my-app

# 4. Install the mkcert root CA for portless (one-time per machine,
#    sudo required). This makes *.<project>.localhost URLs work with a
#    valid HTTPS certificate. Skip if you set DISABLE_PORTLESS=1.
node_modules/.bin/portless trust

# 5. Start dev dependencies (Postgres, RustFS, Mailpit, OTel)
docker compose up -d

# 6. Generate .env — copies .env.example → .env and auto-fills:
#    • Secrets via crypto.randomBytes (BETTER_AUTH_SECRET,
#      POSTGRES_PASSWORD, SYSTEM_SETUP_ADMIN_PASSWORD,
#      FIELD_ENCRYPTION_KEK, S3_SECRET_KEY, POWERSYNC_DB_PASSWORD)
#    • Project-scoped vars from package.json["name"]:
#      POSTGRES_USER/POSTGRES_DB/DATABASE_URL/APP_BASE_URL.
#    Idempotent: refuses to overwrite if .env already exists.
bun run setup

# 7. Apply DB migrations
bun run prisma:migrate

# 8. Start the dev server — portless boots automatically as a sidecar
#    and serves https://api.<project>.localhost. Without portless or
#    with DISABLE_PORTLESS=1, the API binds to a dynamically chosen
#    port (see Bun startup log).
bun run dev
```

### Project rename

When forking the template, run

```bash
bun run rename my-app
```

which surgically rewrites the project name in four files:

| File | What gets replaced |
|---|---|
| `package.json` | `"name"` |
| `README.md` | first H1 (`# nest-server-template` → `# my-app`) |
| `portless.yml` | `project:` + every `*.<project>.localhost` hostname |
| `docker-compose.yml` | top-level `name`, `container_name` prefixes, network `name` |

Idempotent — running it twice with the same name is a no-op; a
follow-up rename to a different name still works. Inline mentions of
the old name in prose are left untouched and can be edited manually if
needed. `kebab-case` is strictly validated
(`/^[a-z][a-z0-9-]*[a-z0-9]$/`); invalid input aborts before any file
is written.

## Configuring features

Feature flags drive which modules get wired into the DI container at
boot. Single source of truth: `src/core/features/features.ts`
(`FeaturesSchema`, Zod). Activation precedence:

1. **Schema defaults** (see table below)
2. **`FEATURE_*` env vars** (override defaults at boot)
3. **Project override** in `src/config/features.ts` (when present)

### Env var format

`FEATURE_<SECTION>_<FIELD>=<value>`

| Section | Env prefix | Fields |
|---|---|---|
| `authMethods` | `FEATURE_AUTH_METHODS_` | `EMAIL_PASSWORD`, `TWO_FACTOR`, `PASSKEY`, `API_KEYS`, `SOCIAL_PROVIDERS` (CSV) |
| `multiTenancy` | `FEATURE_MULTI_TENANCY_` | `ENABLED`, `RLS`, `HEADER_NAME` |
| `files` | `FEATURE_FILES_` | `ENABLED`, `STORAGE_DEFAULT` (`s3`/`local`/`postgres`), `TUS`, `TRANSFORMATIONS` |
| `email` | `FEATURE_EMAIL_` | `ENABLED`, `PROVIDER` (`smtp`/`brevo`) |
| `geo` | `FEATURE_GEO_` | `ENABLED`, `PROVIDER` (`mapbox`/`google`/`nominatim`/`local`) |
| `webhooks` / `search` / `realtime` / `powerSync` / `mcp` / `fieldEncryption` / `rateLimit` / `idempotency` / `observability` / `jobs` | `FEATURE_<SECTION>_` | `ENABLED` |

Boolean values: `true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`
(case-insensitive). Arrays are comma-separated.

### Defaults

| Feature | Default | Note |
|---|---|---|
| `authMethods.emailPassword` | `true` | always-on recommendation |
| `authMethods.twoFactor` / `passkey` / `apiKeys` | `true` | |
| `authMethods.socialProviders` | `[]` | opt-in via CSV |
| `multiTenancy.enabled` | `true` | with `rls: true` |
| `files.enabled` | `true` | with `tus`/`transformations` on |
| `email.enabled` | `true` | provider `smtp` (Mailpit locally) |
| `rateLimit` / `idempotency` / `observability` / `jobs` | `true` | cross-cutting |
| `webhooks` / `search` / `realtime` / `powerSync` / `mcp` / `fieldEncryption` / `geo` | `false` | opt-in per project |

### Examples

```bash
# .env: enable Webhooks + Search
FEATURE_WEBHOOKS_ENABLED=true
FEATURE_SEARCH_ENABLED=true

# Disable passkey auth, add Google + GitHub OAuth
FEATURE_AUTH_METHODS_PASSKEY=false
FEATURE_AUTH_METHODS_SOCIAL_PROVIDERS=google,github

# Switch email to Brevo
FEATURE_EMAIL_PROVIDER=brevo

# Enable Geo + PowerSync (PowerSync requires multiTenancy)
FEATURE_GEO_ENABLED=true
FEATURE_POWERSYNC_ENABLED=true
```

### Feature dependencies

Boot fails fast (`validateFeatureDependencies`) on:

- `webhooks` → requires `jobs` (pg-boss)
- `powerSync` → requires `multiTenancy` (tenant-scoped buckets)
- `production` builds → `rateLimit` must stay enabled

Violations abort the boot with a clear error message.

Step-by-step guide for adding a NEW feature toggle:
[`.claude/skills/adding-feature-flag.md`](./.claude/skills/adding-feature-flag.md).

## Repo layout

```
src/
├── core/      # Template-owned (synced via `bun run sync:from-template`)
├── modules/   # Project-owned (never part of the sync)
└── shared/    # Shared types (channels, events) — published with the SDK
tests/
├── stories/   # TDD story tests, one file per user journey
├── unit/      # Pure-function tests
├── types/     # TypeScript compile-time tests
├── migrate/   # Migration verification
└── k6/        # Load + memory tests
prisma/        # Schema + migrations (feature-specific schemas concatenated)
docker/        # Local dev service configs (otel, …)
generated/     # SDK output (kubb) — published as its own npm package
```

## Commands

All scripts run via `bun run <name>`. Full inventory in `package.json`;
the entries below are the ones used in everyday development.

### Setup & naming

| Script | Purpose |
|---|---|
| `setup` | Generate `.env` from `.env.example`, auto-fill secrets + project vars |
| `rename <name>` | Surgically replace the project name in package.json/README/portless/docker-compose |

### Dev & build

| Script | Purpose |
|---|---|
| `dev` | Start the API in watch mode with portless as a sidecar |
| `build` | Bun bundle into `dist/` (CI smoke; consumers build their own containers) |

### Lint & format

| Script | Purpose |
|---|---|
| `lint` | oxlint (errors-only check) |
| `lint:fix` | oxlint with auto-fix |
| `format` | oxfmt --check (CI mode) |
| `format:fix` | oxfmt writes changes |

### Tests (TDD-required)

| Script | Purpose |
|---|---|
| `test` | full Vitest suite |
| `test:watch` | watch mode |
| `test:unit` | only `tests/unit/` (pure-function) |
| `test:e2e` | E2E specs + story tests (Postgres via testcontainers) |
| `test:types` | `tsc --noEmit` on `tests/types/` |
| `test:coverage` | with coverage report (`reports/coverage/`) |
| `test:perf` | k6 memory test (`tests/k6/`) |

Coverage gates: `src/core/` ≥ 90 %, `src/modules/` ≥ 80 %.

### Database & schema

| Script | Purpose |
|---|---|
| `prepare:schema` | Concatenate active feature schemas into `prisma/schema.prisma` |
| `prisma:generate` | Regenerate the Prisma client |
| `prisma:migrate` | Apply pending migrations (`prisma migrate deploy`) |

### SDK & template sync

| Script | Purpose |
|---|---|
| `sdk:generate` | OpenAPI spec → frontend SDK via kubb |
| `sync:from-template` | Pull template updates into your project (`src/core/`) |
| `sync:to-template` | Prepare local `src/core/` diffs as a PR back to the template |

## CI

The same six quality gates run automatically:

- **GitHub Actions** (`.github/workflows/ci.yml`) — on every push to
  `main` and every PR targeting `main`. Used by the open-source
  template repo on GitHub.
- **GitLab CI** (`.gitlab-ci.yml`) — same stages for consumer projects
  that fork the template and deploy from GitLab.

Both pipelines cover `lint → format → test:unit → test:e2e →
test:types → test:coverage → build` plus an advisory `audit` job
(non-blocking).

## AI assistance

The repo is optimised for working with Claude Code. Workflow discipline
(red-green-refactor TDD, quality gates, slice granularity) is
documented in [`CLAUDE.md`](./CLAUDE.md). Pre-built building blocks:

**Agents** ([`.claude/agents/`](./.claude/agents/)):
- `slice-implementer` — runs a complete TDD slice from PLAN.md §32
- `quality-gate-runner` — runs all six gates including auto-fix where possible
- `module-scaffolder` — scaffolds a new `src/modules/<name>/` subtree

**Skills** ([`.claude/skills/`](./.claude/skills/)):
- `running-tdd-slice` — red-green-refactor step by step
- `adding-feature-module` — add a new resource to the project
- `adding-feature-flag` — add a new toggle to FeaturesSchema
- `adding-error-code` — add a `CORE_*` error code + registry entry
- `wiring-permissions` — CASL ability + DB rule resolver
- `syncing-from-template` — template update workflow

Spec: [`PLAN.md`](./PLAN.md) (§32 = slice list). Iteration history:
[`RALPH_LOG.md`](./RALPH_LOG.md). Open design questions:
[`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md).

## Template sync

```bash
# Pull updates from the template repo (leaves src/modules/ alone)
bun run sync:from-template

# Prepare local src/core/ diffs as a PR back to the template
bun run sync:to-template
```

Detailed guides:

- [Template-Update-Workflow](./docs/template-update-workflow.md) — `sync:from-template` step by step
- [Customization-Guide](./docs/customization-guide.md) — `src/core/` vs `src/modules/`, enabling features, adding new resources
- [Core-Contribution-Guide](./docs/core-contribution-guide.md) — `sync:to-template` + PR-back workflow
- [Consumer-Guide](./docs/consumer-guide.md) — bootstrapping a new project on the template
- [API-Stability-Promise](./docs/api-stability-promise.md) — semver conventions, public surface, deprecation window
- [Webhook-Spec](./docs/webhook-spec.md) — outgoing webhook contract (HMAC-SHA256, retry, auto-disable)

## License

MIT — see [`LICENSE`](./LICENSE).
