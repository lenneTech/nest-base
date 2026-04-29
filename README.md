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

# 2. Repo bootstrappen — installiert auch portless als devDependency
bun install

# 3. Projekt umbenennen (siehe „Projekt-Rename" unten — nur einmal nach
#    dem Klonen)
bun run rename my-app

# 4. mkcert-Root-CA für portless installieren (einmalig pro Maschine,
#    sudo nötig). Damit funktionieren die *.<projekt>.localhost-URLs
#    mit gültigem HTTPS-Zertifikat. Skippen, wenn du DISABLE_PORTLESS=1
#    nutzt.
node_modules/.bin/portless trust

# 5. Dependencies starten (Postgres, RustFS, Mailpit, OTel)
docker compose up -d

# 6. .env generieren — kopiert .env.example → .env und füllt automatisch:
#    • Secrets via crypto.randomBytes (BETTER_AUTH_SECRET,
#      POSTGRES_PASSWORD, SYSTEM_SETUP_ADMIN_PASSWORD,
#      FIELD_ENCRYPTION_KEK, S3_SECRET_KEY, POWERSYNC_DB_PASSWORD)
#    • Projekt-Vars aus package.json["name"]:
#      POSTGRES_USER/POSTGRES_DB/DATABASE_URL/APP_BASE_URL.
#    Idempotent: refused to overwrite, wenn .env schon existiert.
bun run setup

# 7. DB-Migrations
bun run prisma:migrate

# 8. Dev-Server starten — portless wird automatisch mit-gebootet und
#    serviert https://api.<projekt>.localhost. Ohne portless oder mit
#    DISABLE_PORTLESS=1 bindet die API auf einen dynamisch gewählten
#    Port (siehe Bun-Startlog).
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
| `portless.yml` | `project:` + alle `*.<projekt>.localhost`-Hostnames |
| `docker-compose.yml` | top-level `name`, `container_name`-Präfixe, Network `name` |

Idempotent — zweiter Lauf mit demselben Namen passiert nichts; ein
Folge-Rename auf einen anderen Namen funktioniert weiterhin. Andere
inline-Erwähnungen des alten Namens (z. B. in Prosa) bleiben unverändert
und können bei Bedarf manuell angepasst werden. `kebab-case` wird
strikt validiert (`/^[a-z][a-z0-9-]*[a-z0-9]$/`); ungültige Eingaben
brechen ohne Schreibvorgang ab.

## Features konfigurieren

Feature-Flags steuern, welche Module beim Boot in den DI-Container
geladen werden. Single source of truth: `src/core/features/features.ts`
(`FeaturesSchema`, Zod). Aktivierungs-Reihenfolge:

1. **Schema-Defaults** (siehe Tabelle unten)
2. **`FEATURE_*`-ENV-Vars** (überschreiben Defaults beim Boot)
3. **Projekt-Override** in `src/config/features.ts` (sobald angelegt)

### Format der ENV-Vars

`FEATURE_<SECTION>_<FIELD>=<value>`

| Sektion | ENV-Prefix | Felder |
|---|---|---|
| `authMethods` | `FEATURE_AUTH_METHODS_` | `EMAIL_PASSWORD`, `TWO_FACTOR`, `PASSKEY`, `API_KEYS`, `SOCIAL_PROVIDERS` (CSV) |
| `multiTenancy` | `FEATURE_MULTI_TENANCY_` | `ENABLED`, `RLS`, `HEADER_NAME` |
| `files` | `FEATURE_FILES_` | `ENABLED`, `STORAGE_DEFAULT` (`s3`/`local`/`postgres`), `TUS`, `TRANSFORMATIONS` |
| `email` | `FEATURE_EMAIL_` | `ENABLED`, `PROVIDER` (`smtp`/`brevo`) |
| `geo` | `FEATURE_GEO_` | `ENABLED`, `PROVIDER` (`mapbox`/`google`/`nominatim`/`local`) |
| `webhooks` / `search` / `realtime` / `powerSync` / `mcp` / `fieldEncryption` / `rateLimit` / `idempotency` / `observability` / `jobs` | `FEATURE_<SECTION>_` | `ENABLED` |

Boolean-Werte: `true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`
(case-insensitive). Arrays: kommagetrennt.

### Default-Tabelle

| Feature | Default | Hinweis |
|---|---|---|
| `authMethods.emailPassword` | `true` | Always-on Empfehlung |
| `authMethods.twoFactor` / `passkey` / `apiKeys` | `true` | |
| `authMethods.socialProviders` | `[]` | Opt-in via CSV |
| `multiTenancy.enabled` | `true` | mit `rls: true` |
| `files.enabled` | `true` | mit `tus`/`transformations` an |
| `email.enabled` | `true` | Provider `smtp` (Mailpit lokal) |
| `rateLimit` / `idempotency` / `observability` / `jobs` | `true` | Cross-cutting |
| `webhooks` / `search` / `realtime` / `powerSync` / `mcp` / `fieldEncryption` / `geo` | `false` | Opt-in pro Projekt |

### Beispiele

```bash
# .env: Webhooks + Search aktivieren
FEATURE_WEBHOOKS_ENABLED=true
FEATURE_SEARCH_ENABLED=true

# Passkey-Auth deaktivieren, Google-OAuth ergänzen
FEATURE_AUTH_METHODS_PASSKEY=false
FEATURE_AUTH_METHODS_SOCIAL_PROVIDERS=google,github

# Email auf Brevo umstellen
FEATURE_EMAIL_PROVIDER=brevo

# Geo + PowerSync aktivieren (PowerSync verlangt multiTenancy)
FEATURE_GEO_ENABLED=true
FEATURE_POWERSYNC_ENABLED=true
```

### Feature-Abhängigkeiten

Beim Boot fail-fast (`validateFeatureDependencies`):

- `webhooks` → braucht `jobs` (pg-boss)
- `powerSync` → braucht `multiTenancy` (Tenant-Buckets)
- `production`-Build → `rateLimit` muss an bleiben

Verstöße brechen den Boot mit klarer Meldung ab.

Schritt-für-Schritt-Guide für ein NEUES Feature-Toggle:
[`.claude/skills/adding-feature-flag.md`](./.claude/skills/adding-feature-flag.md).

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

## Befehle

Alle Scripts laufen via `bun run <name>`. Vollständige Übersicht in
`package.json`; die folgenden sind die für tägliche Entwicklung wichtigen:

### Setup & Naming

| Script | Zweck |
|---|---|
| `setup` | `.env` aus `.env.example` generieren, Secrets + Projekt-Vars automatisch füllen |
| `rename <name>` | Projekt-Name in package.json/README/portless/docker-compose surgisch ersetzen |

### Dev & Build

| Script | Zweck |
|---|---|
| `dev` | API im Watch-Mode starten, portless als Sidecar |
| `build` | Bun-Bundle nach `dist/` (CI-Smoke; Consumer bauen Container selbst) |

### Lint & Format

| Script | Zweck |
|---|---|
| `lint` | oxlint (Errors-Check) |
| `lint:fix` | oxlint mit Auto-Fix |
| `format` | oxfmt --check (CI-Mode) |
| `format:fix` | oxfmt schreibt Änderungen |

### Tests (TDD-Pflicht)

| Script | Zweck |
|---|---|
| `test` | gesamte Vitest-Suite |
| `test:watch` | Watch-Mode |
| `test:unit` | nur `tests/unit/` (pure-function) |
| `test:e2e` | E2E-Specs + Story-Tests (Postgres via testcontainers) |
| `test:types` | `tsc --noEmit` auf `tests/types/` |
| `test:coverage` | mit Coverage-Report (`reports/coverage/`) |
| `test:perf` | k6-Memory-Test (`tests/k6/`) |

Coverage-Gates: `src/core/` ≥ 90 %, `src/modules/` ≥ 80 %.

### Datenbank & Schema

| Script | Zweck |
|---|---|
| `prepare:schema` | Aktive Feature-Schemas zu `prisma/schema.prisma` konkatenieren |
| `prisma:generate` | Prisma-Client regenerieren |
| `prisma:migrate` | Pending Migrations anwenden (`prisma migrate deploy`) |

### SDK & Template-Sync

| Script | Zweck |
|---|---|
| `sdk:generate` | OpenAPI-Spec → Frontend-SDK via kubb |
| `sync:from-template` | Template-Updates ins eigene Projekt holen (`src/core/`) |
| `sync:to-template` | Lokale `src/core/`-Diffs als PR ans Template vorbereiten |

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

## AI-Assistenz

Das Repo ist auf Arbeit mit Claude Code optimiert. Workflow-Disziplin
(Red-Green-Refactor TDD, Quality-Gates, Slice-Granularität) ist in
[`CLAUDE.md`](./CLAUDE.md) dokumentiert. Pre-built Bausteine:

**Agents** ([`.claude/agents/`](./.claude/agents/)):
- `slice-implementer` — fährt eine komplette TDD-Slice aus PLAN.md §32
- `quality-gate-runner` — alle sechs Gates inkl. Auto-Fix wo möglich
- `module-scaffolder` — neues `src/modules/<name>/`-Subtree anlegen

**Skills** ([`.claude/skills/`](./.claude/skills/)):
- `running-tdd-slice` — Red-Green-Refactor Schritt-für-Schritt
- `adding-feature-module` — neue Resource im Projekt anlegen
- `adding-feature-flag` — neuen Toggle im FeaturesSchema
- `adding-error-code` — `CORE_*`-Errorcode + Registry-Eintrag
- `wiring-permissions` — CASL-Ability + DB-Rule-Resolver
- `syncing-from-template` — Template-Update-Workflow

Spec liegt in [`PLAN.md`](./PLAN.md) (§32 = Slice-Liste).
Iterations-Historie in [`RALPH_LOG.md`](./RALPH_LOG.md). Offene
Design-Fragen in [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md).

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
