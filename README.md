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

Alle Pflicht- und Optional-Phasen aus PLAN.md §32 sind abgeschlossen
(Phase 1–8 + 5b PowerSync + 5c Geo + 6 Email/2FA/Passkey/MCP) — siehe
[`RALPH_LOG.md`](./RALPH_LOG.md). Test-Suite: 1205 Tests in 130 Files,
Coverage ≥ 96 % auf `src/core/`.

## Quickstart

```bash
# 1. Bun installieren (falls noch nicht da)
curl -fsSL https://bun.sh/install | bash

# 2. Repo bootstrappen
bun install

# 3. Projekt umbenennen (siehe „Projekt-Rename" unten — nur einmal nach
#    dem Klonen)
bun run rename my-app

# 4. Dependencies starten (Postgres, RustFS, Mailpit, OTel)
docker compose up -d

# 5. ENV-File anlegen — kopiert .env.example → .env und ersetzt
#    automatisch:
#    • Secrets via crypto.randomBytes (BETTER_AUTH_SECRET,
#      POSTGRES_PASSWORD, SYSTEM_SETUP_ADMIN_PASSWORD,
#      FIELD_ENCRYPTION_KEK, S3_SECRET_KEY, POWERSYNC_DB_PASSWORD)
#    • Projekt-skopierte Vars aus package.json["name"]:
#      POSTGRES_USER/POSTGRES_DB/DATABASE_URL bekommen den Projekt-
#      Namen, APP_BASE_URL wird zur portless-URL
#      (https://api.<projekt>.localhost). Wer kein portless nutzt,
#      passt APP_BASE_URL danach manuell an.
#    Idempotent: refused to overwrite, wenn .env schon existiert.
bun run setup

# 6. DB-Migrations + Seed
bun run prisma:migrate

# 7. Dev-Server starten — portless wird automatisch als devDependency
#    installiert; einmalig vorher `node_modules/.bin/portless trust`
#    ausführen, damit das mkcert-Root-Cert installiert wird (sudo nötig).
#    Ohne portless oder mit DISABLE_PORTLESS=1 fällt der Server auf einen
#    dynamisch gewählten Port zurück (siehe Bun-Startlog).
bun run dev
```

### Projekt-Rename

Beim Forken des Templates läuft

```bash
bun run rename my-app
```

und schreibt den Projektnamen surgisch in vier Dateien:

| Datei | Was wird ersetzt |
|---|---|
| `package.json` | `"name"` |
| `README.md` | erste H1-Zeile (`# nest-server-template` → `# my-app`) |
| `portless.yml` | `project:` + alle `*.nst.localhost`-Hostnames |
| `docker-compose.yml` | top-level `name`, `container_name`-Präfixe, Network `name` |

Idempotent — beim zweiten Lauf mit demselben Namen passiert nichts;
ein Folge-Rename auf einen anderen Namen funktioniert weiterhin. Andere
inline-Erwähnungen des alten Namens (z. B. in Prosa) bleiben unverändert
und können bei Bedarf manuell angepasst werden. `kebab-case` wird
strikt validiert (`/^[a-z][a-z0-9-]*[a-z0-9]$/`); ungültige Eingaben
brechen ohne Schreibvorgang ab.

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

## CI

Die gleichen sechs Quality-Gates laufen automatisch:

- **GitHub Actions** (`.github/workflows/ci.yml`) — auf jedem Push nach
  `main` und auf jeden PR gegen `main`. Wird im OSS-Template-Repo auf
  GitHub genutzt.
- **GitLab CI** (`.gitlab-ci.yml`) — gleiche Stages für Consumer-
  Projekte, die das Template forken und nach GitLab deployen.

Beide Pipelines decken `lint → format → test:unit → test:e2e →
test:types → test:coverage → build` plus einen advisory `audit`-Job
(non-blocking) ab.

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
