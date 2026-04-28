# nest-server-template

Template-fähiger NestJS-Server auf Bun + Prisma + Postgres + Better-Auth.
Gedacht als Starter für `lt fullstack init` und als Sync-Quelle für `src/core/`.

## Stack

| Layer | Tool |
|---|---|
| Runtime | Bun 1.x (Fallback: Node 22) |
| Framework | NestJS 11 |
| ORM | Prisma 7 (driver-adapter) |
| DB | Postgres 18 |
| Auth | Better-Auth |
| Validation | Zod 4 + nestjs-zod |
| Tests | Vitest + Supertest |
| Lint/Format | oxlint / oxfmt |
| SDK-Generation | kubb |
| Object-Storage | RustFS (S3-API) |
| Realtime | Socket.IO + Postgres NOTIFY |
| Job-Queue | pg-boss |
| Files (TUS) | @tus/server v3 |
| Image-Transform | sharp |
| CI | GitLab CI |
| Local-Dev-Routing | portless |
| License | MIT |

Vollständige Spec: [`PLAN.md`](./PLAN.md). AI-Agent-Guide:
[`CLAUDE.md`](./CLAUDE.md).

## Status

Alle Pflicht-Phasen + Optional-Phase 6 (Email/2FA/Passkey/MCP) sind
abgeschlossen — siehe [`RALPH_LOG.md`](./RALPH_LOG.md). Test-Suite:
1012 Tests in 106 Files, Coverage ≥ 96 % auf `src/core/`. Optional-
Phasen 5b (PowerSync) und 5c (Geo) sind per `RALPH_DIRECTIVES.md`
deaktiviert; jedes Projekt kann sie nachschalten.

## Quickstart

```bash
# 1. Bun installieren (falls noch nicht da)
curl -fsSL https://bun.sh/install | bash

# 2. Repo bootstrappen
bun install

# 3. Dependencies starten (Postgres, RustFS, Mailpit, OTel)
docker compose up -d

# 4. ENV-File anlegen
cp .env.example .env

# 5. DB-Migrations + Seed
bun run prisma:migrate

# 6. Dev-Server starten (portless wenn vorhanden, sonst dynamischer Port)
bun run dev
```

## Repo-Layout

```
src/
├── core/      # Template-Owned (Sync via `bun run sync:from-template`)
├── modules/   # Projekt-Owned (niemals Teil von Sync)
└── shared/    # Gemeinsame Types (Channels, Events) — wird mit SDK publiziert
tests/
├── stories/   # TDD-Story-Tests pro User-Journey
├── unit/      # Pure-Function-Tests
├── types/     # TypeScript-Compile-Tests
├── migrate/   # Migration-Verification
└── k6/        # Load-/Memory-Tests
prisma/        # Schema + Migrations (Feature-spezifische Schemas konkateniert)
docker/        # Lokale Dev-Service-Configs (otel, …)
generated/     # SDK-Output (kubb) — published als eigenes npm-Paket
```

## Tests (TDD-Pflicht)

```bash
bun run test           # alle Tests
bun run test:watch     # Watch-Mode
bun run test:unit      # nur Unit-Tests
bun run test:e2e       # E2E + Stories
bun run test:types     # tsc auf tests/types
bun run test:coverage  # Coverage-Report
```

Coverage-Gates: `src/core/` ≥ 90 %, `src/modules/` ≥ 80 %.

Workflow-Disziplin (Red-Green-Refactor) ist in
[`CLAUDE.md`](./CLAUDE.md) und der `running-tdd-slice` Skill
beschrieben. Pre-built Agents für häufige Tasks liegen in
[`.claude/agents/`](./.claude/agents/), Skills in
[`.claude/skills/`](./.claude/skills/).

## Template-Sync

```bash
# Update aus Template-Repo holen (lässt src/modules/ unangetastet)
bun run sync:from-template

# Lokale src/core/-Änderungen als PR-Patch ans Template vorbereiten
bun run sync:to-template
```

Detaillierte Guides:

- [Template-Update-Workflow](./docs/template-update-workflow.md) — `sync:from-template` Schritt für Schritt
- [Customization-Guide](./docs/customization-guide.md) — `src/core/` vs `src/modules/`, Features aktivieren, neue Resources anlegen
- [Core-Contribution-Guide](./docs/core-contribution-guide.md) — `sync:to-template` + PR-zurück-Workflow
- [Consumer-Guide](./docs/consumer-guide.md) — Bootstrapping eines neuen Projekts auf der Template-Basis
- [API-Stability-Promise](./docs/api-stability-promise.md) — Semver-Konventionen, Public-Surface, Deprecation-Window
- [Webhook-Spec](./docs/webhook-spec.md) — Outgoing-Webhook-Vertrag (HMAC-SHA256, Retry, Auto-Disable)

## Lizenz

MIT — siehe [`LICENSE`](./LICENSE).
