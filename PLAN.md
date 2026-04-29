# Anforderungskatalog – Neue Server-Version (Prisma + Postgres)

> Status: Draft v1 – 2026-04-28
> Grundlage: bestehender `@lenne.tech/nest-server` (Vendored Baseline 11.25.3)
> Ziel: Frischer Stack mit Prisma, Postgres, Directus-inspiriertem File- & Permission-Handling

---

## 1. Vision & Leitprinzipien

### 1.1 Was wir bauen
Ein moderner, stark typisierter NestJS-Server mit:
- **Prisma + Postgres** als zentrale Persistenzschicht
- **Better-Auth** als einziges Auth-System
- **Directus-Style File-Handling** (DB-Modell + Storage-Adapter, RustFS S3 als Default)
- **Directus-Style Permissions** (in DB konfigurierbar, Role × Collection × Action × Filter-Rules)
- **Postgres RLS** als zusätzliche Tenant-Isolation auf DB-Layer

> **Nicht enthalten:** Frontend-App. Dieses Repository ist ein **reines Server-Template**. Die einzige browserseitige Oberfläche ist das interne Dev-/Admin-Panel (Kap. 27, nur in Dev oder hinter Admin-Permission). Konsumierende Frontends installieren das via `kubb` generierte API-SDK (Kap. 27.7) und leben in eigenen Repos.

### 1.2 Leitprinzipien
1. **Template-Charakter** – Dieser Server ist die Basis für viele Projekte mit unterschiedlichen Anforderungen. Module sind opt-in, deaktivierte Features haben **keinen** Performance- oder Komplexitätsfootprint.
2. **Convention over Configuration** – Zero-Config wo möglich, alles abschaltbar.
3. **Defense in Depth** – Berechtigungen auf API-, Service- und DB-Layer (RLS).
4. **DB-konfigurierbar statt Code-konfigurierbar** – Permissions, File-Folder, Storage-Locations leben in der DB.
5. **Standards statt Eigenbau** – Better-Auth, Zod, Prisma, S3-API, OpenAPI 3.1.
6. **Strikte Typisierung** – kein implizites `any`, Zod-Schemas als Single Source of Truth.
7. **Sichere Defaults** – Defaults sind production-tauglich; Aktivierung gefährlicher Optionen (CORS-Wildcard, Rate-Limit-Off) explizit erforderlich.
8. **Test-Driven Development** – Jedes Feature, jeder Bugfix und jede Core-Änderung folgt dem Red-Green-Refactor-Zyklus. Story-/E2E-Tests werden **vor** der Implementation geschrieben. Testing-Strategie und Pattern-Vorlage (orientiert an [`lenneTech/nest-server/tests`](https://github.com/lenneTech/nest-server/tree/develop/tests)) sind in Kap. 28b dokumentiert.

### 1.3 Template-Charakter & Projekt-Customization

Dieser Server ist **kein fertiges Produkt für einen einzelnen Use-Case**. Er ist die **gemeinsame Basis** für Projekte mit sehr unterschiedlichen Anforderungen — manche Apps brauchen Multi-Tenancy, manche nicht; manche brauchen Mobile-Sync, manche nicht; manche haben PII-Compliance, manche nicht.

**Daraus folgt:**
- **Jedes Modul** in den Kapiteln 8-15 ist **opt-in**. Auch einige aus 4-7 sind teilweise abschaltbar (z.B. Multi-Tenancy in Kap. 5, einzelne Auth-Methoden in Kap. 4).
- **Aktivierung** erfolgt über zentralen Config-Mechanismus (siehe Kap. 19 — Feature-Aktivierung).
- **Deaktivierte Module** werden nicht in den DI-Container geladen, ihre Routes werden nicht registriert, ihre Migrations werden nicht ausgeführt — Footprint = 0.
- **Defaults** sind so gewählt, dass typische SaaS-Apps direkt funktionieren (Multi-Tenancy + Auth + Permissions + Files + Realtime an, PowerSync/MCP/Webhooks aus).
- **Per-Projekt-Customization** lebt in `src/modules/` und ENV/DB-Konfiguration; Core-Module (`src/core/`) bleiben unverändert pro Projekt.
- **Bidirektionaler Template-Sync:** Updates am Template fließen via `bun run sync:from-template` ins Projekt (nur `src/core/`, niemals `src/modules/`). Verbesserungen, die in einem Projekt am `src/core/` entstehen, werden über `bun run sync:to-template` als **Pull Request zurück ins Template-Repo** gespielt — so bleibt die Core-Lib lebendig und Projekte profitieren gegenseitig (siehe Kap. 19.9).

Eine vollständige Aktivierungs-Matrix mit ENV-Variablen, Default-Werten und Abhängigkeiten zwischen Modulen findet sich in **Kapitel 19**.

### 1.4 Out of Scope (explizit gestrichen)
| Gestrichen | Begründung |
|---|---|
| GraphQL / Apollo / Subscriptions | REST + OpenAPI ist für unsere Use-Cases ausreichend, halbiert die Komplexität |
| Legacy Auth (CoreAuthService) | Better-Auth deckt alles ab, kein Migrationspfad mehr nötig |
| Vendor-Mode | War ein Workaround für Code-Comprehension. Bei einem Greenfield-Projekt unnötig |
| Mailjet | Brevo deckt alle Use-Cases ab |
| Mongoose / MongoDB / GridFS | Prisma + Postgres + S3-Storage |
| `@UnifiedField`-Decorator-System | Prisma-Schema + Zod-DTOs sind die SoT, GraphQL/Mongoose-Bridge entfällt |
| Selbstgebauter `@Restricted`/`@Roles`-Stack | Ersetzt durch DB-konfigurierbares Permission-System |
| `process()`-Pipeline mit Force/Raw | Vereinfacht durch klare Service- vs Repo-Trennung |

---

## 2. Tech Stack

| Layer | Wahl | Begründung |
|---|---|---|
| Runtime | **Bun 1.2+** | TypeScript-First, ~3× schneller Startup, Built-in Test-Runner, native SQL/Crypto, NPM-kompatibel. Node 22 als Fallback (Library-Kompatibilität bei Bedarf). |
| Framework | NestJS 11 | DI, Modularität, Decorators, Swagger-Integration. Läuft stabil auf Bun. |
| Sprache | TypeScript 5.9+ strict | Native Execution durch Bun, keine `tsx`/`ts-node`-Layer |
| ORM | Prisma 7 | Typsicher, Migrations, Postgres-First, Extensions |
| DB | Postgres 18 | RLS, JSONB, FTS (`tsvector`/GIN), `LISTEN/NOTIFY`, `pg_largeobject`, Reife |
| Auth | Better-Auth 1.5+ | Email/PW, OAuth, 2FA, Passkey, Sessions, JWT |
| API-Keys | Eigenbau auf argon2id-Hash + Scopes | Service-Accounts, CI (MCP nutzt OAuth) |
| Authorization | **CASL 6** + DB-Persistenz für Rules | Industry-Standard, skaliert auf Enterprise-Komplexität, Field- & Item-Level |
| Output-Filter | OutputPipelineInterceptor (4-Stage) | Defense-in-Depth: Translate → CASL → Filter-Service → Secret-Safety-Net |
| Validation | Zod 4 | Single SoT für DTOs + OpenAPI-Generierung |
| API-Filter | PostgREST-Standard (URL-Notation) | Industry-Standard im Postgres-Ökosystem |
| API-Doku | OpenAPI 3.1 via `@nestjs/swagger` | Standard, Tools verfügbar |
| API-UI | **Scalar** (`@scalar/nestjs-api-reference`) | Modernes Try-It-Out, Code-Snippets, Search |
| Dev-Tools | **NestJS DevTools** (`@nestjs/devtools-integration`) | Module-Graph, Routes, Dependencies visualisiert |
| Dev-Hub | Eigene Landing-Page `/dev` | Zentrale Navigation zu allen Tools |
| File-Storage | S3 (RustFS-Default) / Local / Postgres | Drei Adapter, gleiches Interface |
| Email | Nodemailer + Brevo SDK | SMTP für Dev/Test, Brevo für Prod |
| Webhooks | Eigenbau auf pg-boss + HMAC-SHA256 | Standard-Webhooks-Spec, Signature-Header |
| Search | Postgres FTS (`tsvector` + GIN) | Eingebaut, keine externe Infrastruktur |
| Realtime | Postgres `LISTEN/NOTIFY` + Socket.IO | Multi-Instance-tauglich ohne Redis (für Web) |
| Mobile-Sync | PowerSync (self-hosted oder Cloud) + SQLite-Client | Offline-First für React Native / Flutter |
| Encryption | AES-256-GCM via `@47ng/cloak` | NIST-empfohlen, Versioning, Vault-kompatibel |
| Geo / Spatial | PostGIS + Provider-Adapter (Mapbox / Nominatim / Google) | De-facto-Standard für Postgres-Geo, GeoJSON-I/O |
| MCP | `@modelcontextprotocol/sdk` | Standardisiertes AI-Integration-Protocol |
| Job-Queue | pg-boss (Postgres-native) | Cron, Background-Jobs, Outbox-Worker, kein Redis nötig |
| Rate-Limit | `@nestjs/throttler` + Postgres-Store | Multi-Window, Multi-Instance-tauglich |
| Observability | OpenTelemetry (OTLP) + Pino | Distributed Tracing, Metrics, korrelierte Logs |
| Errors | RFC 7807 Problem Details | Industry-Standard, Frontend-Tooling vorhanden |
| Security-Headers | Helmet + CSP | Standard Defense-in-Depth |
| ID-Strategie | UUID v7 (`pg_uuidv7`) | Zeitsortiert, bessere Index-Performance |
| Tests | Vitest (Default) + Bun Test (Performance-Spezialfälle) | Größeres Plugin-Ökosystem (Coverage/UI/Snapshots), framework-unabhängig; Bun Test nur für gezielte Performance-Tests |
| Lint/Format | oxlint + oxfmt | Rust-basiert, sehr schnell |
| Local-Dev-Routing | [portless](https://github.com/vercel-labs/portless) | Hostname-basiertes Routing (`*.localhost` mit automatischem HTTPS via mkcert), keine Port-Kollisionen, mehrere Server-Instanzen parallel laufbar |
| Container (nur Dev-Dependencies) | Docker + docker-compose | Bringt nur Postgres, RustFS, Mailpit und den OTel-Collector. Der Server selbst läuft nativ via `bun --watch` — das Template wird **nicht** als deploybares Image publiziert; konsumierende Projekte bauen ihre eigenen Production-Images. |
| Migrations | Prisma Migrate | Idiomatisch zu Prisma |

---

## 3. Modul-Übersicht

```
src/
├── main.ts
├── app.module.ts
├── config/
│   ├── env.config.ts
│   └── env.schema.ts                # Zod-Validation für ENV-Vars
├── core/
│   ├── auth/                        # Better-Auth Integration
│   ├── api-keys/                    # Scoped Service-Account-Keys
│   ├── permissions/                 # CASL-Engine + DB-Persistenz für Rules
│   ├── output-pipeline/             # 4-Stage-Interceptor (Translate → CASL → Filter → Secrets)
│   ├── filters/                     # @FilterFor()-Registry + ResourceFilter-Interface
│   ├── tenancy/                     # Multi-Tenancy + RLS
│   ├── files/                       # Directus-Style File-Handling
│   ├── storage/                     # Storage-Adapter (S3, Local, Postgres)
│   ├── email/                       # Nodemailer + Brevo
│   ├── webhooks/                    # Outgoing Webhooks (HMAC, Retries)
│   ├── search/                      # Postgres FTS Cross-Resource-Search
│   ├── realtime/                    # LISTEN/NOTIFY → Socket.IO
│   ├── powersync/                   # PowerSync-Upload-Handler + Sync-Rules-Mgmt
│   ├── encryption/                  # Field-Level AES-256-GCM
│   ├── geo/                         # PostGIS + Geocoding-Provider + GeoService
│   ├── mcp/                         # Model Context Protocol Server
│   ├── jobs/                        # pg-boss Wrapper (Cron + Background)
│   ├── outbox/                      # Outbox-Pattern für reliable Events
│   ├── error-codes/                 # Strukturierte Error-Codes mit i18n
│   ├── health/                      # Health-Checks
│   ├── system-setup/                # Initial-Admin-Bootstrap
│   ├── audit/                       # Audit-Log + createdBy/updatedBy
│   ├── request-context/             # AsyncLocalStorage
│   ├── observability/               # OpenTelemetry Setup
│   ├── dev-experience/              # Scalar + NestJS DevTools + Dev-Hub + Diagnostics
│   └── common/                      # Decorators, Pipes, Filters, Helpers
├── modules/                         # Project-spezifische Module
│   ├── users/
│   ├── roles/
│   ├── policies/
│   └── ...
└── prisma/
    ├── schema.prisma
    ├── migrations/
    └── seed.ts
```

---

## 4. Authentifizierung (Better-Auth Only)

### 4.1 Features
- **Email + Passwort** (Default an)
- **Social Login** (Google, GitHub, Apple, Discord, alle BA-Provider) – Aktivierung via DB-Konfiguration ODER ENV-Vars
- **Passkey/WebAuthn** (auto-detection aus `BASE_URL`)
- **2FA TOTP** (App-Name aus Config)
- **JWT-Plugin** (asymmetrische Keys in DB, Rotation möglich)
- **Sessions** (DB-backed via Prisma)
- **Email-Verifizierung** (Token-Expiry, Resend-Cooldown, Auto-SignIn)
- **Sign-Up-Validation** (Pflichtfelder konfigurierbar, default `termsAndPrivacyAccepted`)
- **Cross-Subdomain-Cookies** (Auto-Domain-Derivation)
- **`disableSignUp`-Flag**

### 4.2 Endpunkte
Alle unter `/auth` (Better-Auth Standard-Mount):
- `POST /auth/sign-in/email`
- `POST /auth/sign-up/email`
- `POST /auth/sign-out`
- `GET /auth/session`
- `POST /auth/verify-email`
- `POST /auth/forget-password`
- `POST /auth/reset-password`
- `POST /auth/two-factor/enable|verify|disable`
- `POST /auth/passkey/register|authenticate`
- `GET /auth/sign-in/social/:provider`

### 4.3 Sicherheit
- **Rate-Limiting** auf allen Auth-Endpoints (default: 10/min, sign-in/sign-up: 5/min, mit LRU-Cap)
- **`preventUserEnumeration`** standardmäßig an (immer "Invalid credentials")
- **Brute-Force-Lockout** nach N Fehlversuchen pro Email (TTL-basiert)
- **Password-Policy** (min 12 Zeichen, mind. 1 Zahl, 1 Groß-/Kleinbuchstabe, 1 Sonderzeichen) – konfigurierbar
- **Resend-Cooldown** für Verifizierungsmails (default 60s)
- **HMAC-signierte httpOnly-Cookies** mit `Secure`-Flag in Production
- **Production-Safety-Assert** beim Boot (verweigert Start bei unsicherer Cookie-Config)

### 4.4 Datenmodell (Prisma)
```prisma
model User {
  id                  String    @id @default(uuid()) @db.Uuid
  email               String    @unique
  emailVerified       Boolean   @default(false)
  emailVerifiedAt     DateTime?
  name                String?
  image               String?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  // Better-Auth managed
  accounts            Account[]
  sessions            Session[]
  // Project-specific
  roleId              String?   @db.Uuid
  role                Role?     @relation(fields: [roleId], references: [id])
  tenantMemberships   TenantMember[]
  // Audit
  createdBy           String?   @db.Uuid
  updatedBy           String?   @db.Uuid
}

model Account { /* Better-Auth */ }
model Session { /* Better-Auth */ }
model VerificationToken { /* Better-Auth */ }
model TwoFactor { /* Better-Auth */ }
model Passkey { /* Better-Auth */ }
model Jwks { /* Better-Auth JWT */ }
```

### 4.5 Scoped API-Keys (Service-Accounts)
Für Server-zu-Server-Integrationen, MCP-Clients, CI-Pipelines, externe Skripte. Permission-System bleibt einheitlich — API-Keys tragen Scopes, die auf `(resource, action)`-Permissions gemappt werden.

#### 4.5.1 Datenmodell
```prisma
model ApiKey {
  id          String   @id @default(uuid()) @db.Uuid
  // Public Prefix für Identifikation (z.B. "sk_live_a1b2c3")
  prefix      String   @unique
  // bcrypt/argon2-Hash des kompletten Keys; Klartext nur einmal beim Erstellen sichtbar
  keyHash     String
  name        String                                // human-readable
  description String?
  // Scopes wie "projects:read", "files:write", "mcp:invoke", "*"
  scopes      String[]
  // Optionaler Permission-Override (statt Scopes → direkter Policy-Bezug)
  policyId    String?  @db.Uuid
  policy      Policy?  @relation(fields: [policyId], references: [id])
  // Owner & Tenant
  userId      String?  @db.Uuid                      // Service-Account-Owner
  tenantId    String?  @db.Uuid                      // Tenant-Scope
  // Lifecycle
  expiresAt   DateTime?
  lastUsedAt  DateTime?
  lastUsedIp  String?
  revokedAt   DateTime?
  revokedReason String?
  // Audit
  createdBy   String?  @db.Uuid
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([userId])
  @@index([tenantId])
  @@index([prefix])
}
```

#### 4.5.2 Key-Format
```
sk_<env>_<prefix-12chars>_<secret-32chars>
   │      │                │
   │      │                └─ Random 32 Zeichen (base62), nur einmal angezeigt
   │      └─ Public Prefix: zeigbar in UI, in Logs, für Identifikation
   └─ Environment: live / test
```
Beispiel: `sk_live_a1b2c3d4e5f6_X9pQrM2nK7wY3vL8zT4hN6cF5jB2aD1`

#### 4.5.3 Validierung & Auth-Flow
1. Header: `Authorization: Bearer sk_live_...` ODER `X-API-Key: sk_live_...`
2. `ApiKeyGuard` extrahiert Prefix → DB-Lookup
3. Hash-Vergleich (constant-time)
4. Checks: nicht revoked, nicht expired, Tenant-Scope passt
5. `lastUsedAt` + `lastUsedIp` async aktualisiert (Throttled, max 1× pro Minute pro Key)
6. RequestContext gefüllt mit `apiKeyId`, `userId` (= Service-Account), `scopes`

#### 4.5.4 Scopes
Format `<resource>:<action>` analog zu Permission-System:
```
projects:read
projects:write          # impliziert create+update
projects:*              # alle Actions
*                       # alle Resources & Actions (admin-level, nur intern)
mcp:invoke              # MCP-Tools aufrufen
files:upload
webhooks:manage
```
Scope-Auflösung pro Request: API-Key-Scopes → Set von `(resource, action)` → wird im PermissionService neben User-Permissions geprüft. Ein API-Key kann **nicht** mehr dürfen als der besitzende User-/Service-Account.

#### 4.5.5 Endpunkte
| Method | Path | Beschreibung |
|---|---|---|
| `GET` | `/api-keys` | Eigene Keys listen (zeigt Prefix + Metadata, **nie** Secret) |
| `POST` | `/api-keys` | Neuer Key — Response zeigt **einmalig** den vollen Key |
| `DELETE` | `/api-keys/:id` | Revoke (immediate) |
| `PATCH` | `/api-keys/:id` | Name/Scopes ändern, **nicht** Secret |
| `POST` | `/api-keys/:id/rotate` | Neuer Secret, alter expired in 24h (Grace-Period für Rollout) |

#### 4.5.6 Sicherheit
- Hashing: **argon2id** mit angemessenen Parametern (memory 64MB, iterations 3)
- Prefix-Lookup-Index ist **public**, Hash-Vergleich erfolgt nur bei Treffer (verhindert Enumeration)
- Rate-Limit pro API-Key (eigener Bucket, nicht User-Bucket)
- Audit-Log für `key.created / .rotated / .revoked / .used` (Used nur bei Permission-Denied, sonst zu noisy)
- Auto-Expiry-Default: 90 Tage (überschreibbar bis max 1 Jahr für non-MCP, kein Limit für MCP-only-Keys)
- Webhook-Event `apiKey.expiringSoon` 7 Tage vor Ablauf

---

## 5. Multi-Tenancy

> **Aktivierung:** default ON via `features.multiTenancy.enabled = true`. Bei Single-Tenant-Apps explizit auf `false` setzen — entfernt RLS-Policies, Tenant-Interceptor, `TenantMember`-Modell und `X-Tenant-Id`-Routing. Permission-System läuft ohne Tenant-Variablen.

### 5.1 Architektur
**Zwei Layer parallel** (Defense-in-Depth):

1. **App-Layer:** `TenantInterceptor` liest `X-Tenant-Id`-Header, validiert Membership, setzt Postgres-Session-Variable `app.current_tenant_id`.
2. **DB-Layer:** **Postgres Row-Level Security (RLS)** auf jeder tenant-skopierten Tabelle filtert automatisch nach `app.current_tenant_id`.

### 5.2 Vorteile gegenüber Mongoose-Plugin-Lösung
- Garantierte Isolation auch bei rohen SQL-Queries oder fehlerhaftem App-Code
- Postgres erzwingt Filter, kein Workaround möglich
- Audit-fähig via `pg_audit`

### 5.3 Datenmodell
```prisma
model Tenant {
  id          String   @id @default(uuid()) @db.Uuid
  slug        String   @unique
  name        String
  status      TenantStatus @default(ACTIVE)
  createdAt   DateTime @default(now())
  members     TenantMember[]
}

model TenantMember {
  id           String   @id @default(uuid()) @db.Uuid
  userId       String   @db.Uuid
  tenantId     String   @db.Uuid
  role         String   // referenziert Role.id ODER hierarchical level
  status       TenantMemberStatus @default(ACTIVE)
  invitedAt    DateTime?
  joinedAt     DateTime?
  user         User     @relation(fields: [userId], references: [id])
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  @@unique([userId, tenantId])
}

enum TenantMemberStatus { ACTIVE INVITED SUSPENDED }
enum TenantStatus { ACTIVE SUSPENDED ARCHIVED }
```

### 5.4 RLS-Setup-Beispiel
```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON projects
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY admin_bypass ON projects
  USING (current_setting('app.is_system_admin', true) = 'true');
```

### 5.5 API-Layer
- `TenantInterceptor` (global) liest Header → Membership-Lookup → setzt `app.current_tenant_id` im Prisma-Connection-Pool
- `@SkipTenant()` Decorator für Endpoints ohne Tenant (z.B. `/auth/*`, `/system/*`)
- `@CurrentTenant()` Param-Decorator
- Membership-Cache (default 30s TTL, configurable, 0 = aus)

---

## 6. Permission-System (CASL + Directus-Style DB-Modell)

### 6.1 Designziele
- **DB-konfigurierbar** ohne Code-Deployment
- **CASL als Permission-Engine** (Industry-Standard, skaliert auf Enterprise-Komplexität)
- **Field-Level**-Granularität (welche Felder darf eine Rolle lesen/schreiben)
- **Item-Level**-Filter via Filter-Rules (`{"status": {"_eq": "published"}}`)
- **Policy-Bündelung** (mehrere Permissions = Policy, einer Rolle zuweisbar)
- **Public-Rolle** für nicht-eingeloggte User
- **Admin-Bypass** (System-Admin sieht alles)
- **Caching** für Performance (in-memory + Invalidation-Events)
- **Defense-in-Depth**: CASL-Layer (App) + Permission-Filter (Prisma WHERE) + RLS (Postgres)

### 6.2 CASL als Permission-Engine
[CASL](https://casl.js.org) ist der de-facto-Standard für komplexe Permissions in TypeScript-Apps und passt strukturell zu unserem Modell. Statt Eigenbau-Filter-Auswertung nutzen wir CASL als Engine — unsere DB-Tabellen (`Role`, `Policy`, `Permission`) werden dabei zur **Persistenz-Schicht** für CASL-Rules.

**Was CASL liefert:**
- `can(action, subject, conditions)` / `cannot(...)` Rule-DSL
- Field-Level-Permissions (`can('update', 'Project', ['name', 'description'])`)
- Item-Level-Conditions als JSON serialisierbar (passt direkt in unsere `Permission.itemFilter`-Spalte)
- Native Bridges:
  - `@casl/prisma` → CASL-Conditions → Prisma `WHERE`
  - `@casl/ability/extra` → `accessibleBy()` für Repository-Filter
- Inverse-Rules (`cannot`)
- Inheritance via Subject-Hierarchies
- Battle-tested in Großprojekten

**Datenfluss pro Request:**
```
1. PermissionService.resolveForUser(userId, tenantId)
   → DB-Query: Role + Policies + Permissions + RolePolicy + ApiKey-Scopes
   → Übersetzung in CASL-Rules
   → Caching pro User (TTL 60s, Invalidation-Event-getrieben)

2. Authorization-Check
   → ability.can('update', project, 'budget')   // Field-Level
   → throw ForbiddenException oder weiter

3. Read-Filter
   → const where = accessibleBy(ability, 'read').Project
   → prisma.project.findMany({ where })
   // Filter ist automatisch tenant-aware via $CURRENT_TENANT-Variable

4. Field-Filtering vor Response
   → permittedFieldsOf(ability, 'read', project)   // Felder-Whitelist
   → in der Response-Pipeline (siehe Kap. 7)
```

**Beispiel-Resolution:**
```typescript
// DB: Permission { resource: "Project", action: "READ", itemFilter: {...}, fields: [...] }
// → CASL-Rule:
{
  action: 'read',
  subject: 'Project',
  conditions: { tenantId: '$CURRENT_TENANT', status: 'published' },
  fields: ['id', 'name', 'description', 'status'],
}

// Service nutzt es so:
const ability = await this.permissions.abilityFor(user);
ForbiddenError.from(ability).throwUnlessCan('update', project);

const projects = await this.prisma.project.findMany({
  where: accessibleBy(ability, 'read').Project,
});
```

### 6.2.1 Variablen-Resolution
CASL-Conditions können Variablen-Marker enthalten, die vor Evaluation aufgelöst werden:
- `$CURRENT_USER` → User-ID aus RequestContext
- `$CURRENT_TENANT` → Tenant-ID aus RequestContext
- `$CURRENT_USER_ROLES` → Rollen-Array
- `$CURRENT_TENANT_ROLE` → Tenant-Rolle (member/manager/owner)
- `$NOW` → aktueller Zeitstempel

PermissionService führt Resolution durch, bevor Rules an CASL übergeben werden.

### 6.3 Datenmodell
```prisma
model Role {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @unique
  description String?
  isSystem    Boolean  @default(false)   // ADMIN-Rolle, nicht löschbar
  isPublic    Boolean  @default(false)   // Default-Rolle für unauth Requests
  parentId    String?  @db.Uuid          // Vererbung
  parent      Role?    @relation("RoleHierarchy", fields: [parentId], references: [id])
  children    Role[]   @relation("RoleHierarchy")
  policies    RolePolicy[]
  users       User[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Policy {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @unique
  description String?
  permissions Permission[]
  roles       RolePolicy[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model RolePolicy {
  roleId    String  @db.Uuid
  policyId  String  @db.Uuid
  role      Role    @relation(fields: [roleId], references: [id], onDelete: Cascade)
  policy    Policy  @relation(fields: [policyId], references: [id], onDelete: Cascade)
  @@id([roleId, policyId])
}

model Permission {
  id              String   @id @default(uuid()) @db.Uuid
  policyId        String   @db.Uuid
  policy          Policy   @relation(fields: [policyId], references: [id], onDelete: Cascade)
  resource        String   // z.B. "projects", "files", "users"
  action          PermissionAction
  // Item-Level: JSON-Filter-Rule, evaluiert pro Request
  // Beispiel: { "status": { "_eq": "published" } }
  // Beispiel: { "user_created": { "_eq": "$CURRENT_USER" } }
  itemFilter      Json?
  // Field-Level: Whitelist der erlaubten Felder
  // Null/Undefined oder [] = keine Field-Level-Restriction (alle Felder erlaubt);
  // explizite Liste = nur diese Felder lesbar.
  // Hinweis: CASL akzeptiert keine leere `fields`-Liste in einer Rule
  // (`rawRule.fields cannot be an empty array`); deshalb behandelt
  // `buildAbility()` `fields = []` synonym zu „keine Restriction" und
  // die Output-Pipeline-Stage 2 (Field-Allowlist) liefert das Resultset
  // ungefiltert aus. Wer „deny all fields" semantisch braucht, setzt
  // stattdessen einen `inverted: true` Rule oder lässt die Rule weg.
  fields          String[]
  // Validation-Rules (für create/update): Pflichtwerte, Wertebereiche
  validation      Json?
  // Presets: Default-Werte beim Create
  presets         Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([policyId, resource, action])
}

enum PermissionAction {
  CREATE
  READ
  UPDATE
  DELETE
  SHARE          // Sharing/Export
}
```

### 6.4 Filter-Rule-DSL (CASL-kompatibel)
Lehnt sich an Directus an. Operatoren:
```
_eq _neq _lt _lte _gt _gte _in _nin _null _nnull
_contains _ncontains _starts_with _ends_with
_between _nbetween _empty _nempty
_and _or _not
```
Variablen:
- `$CURRENT_USER` – aktuelle User-ID
- `$CURRENT_TENANT` – aktuelle Tenant-ID
- `$CURRENT_ROLE` – Rollen-ID
- `$NOW` – aktueller Zeitstempel

Beispiel:
```json
{
  "_and": [
    { "tenant_id": { "_eq": "$CURRENT_TENANT" } },
    {
      "_or": [
        { "owner_id": { "_eq": "$CURRENT_USER" } },
        { "status": { "_eq": "published" } }
      ]
    }
  ]
}
```

### 6.5 Permission-Engine API
```typescript
import type { AppAbility } from '@casl/ability';

@Injectable()
export class PermissionService {
  // Lädt CASL-Ability für User (DB-Query → CASL-Rules, mit Variablen-Resolution + Cache)
  async abilityFor(user: User | null, tenantId?: string): Promise<AppAbility>;

  // Convenience: throw ForbiddenException wenn nicht erlaubt
  async authorize(user: User | null, action: string, subject: SubjectType, item?: any): Promise<void>;

  // Prisma-WHERE für Read-Queries aus Ability ableiten
  prismaFilterFor(ability: AppAbility, action: string, subject: SubjectType): Prisma.WhereInput;

  // Field-Whitelist für Response
  permittedFields(ability: AppAbility, action: string, subject: any): string[];

  // Cache invalidieren (nach Role/Policy/Permission-Updates)
  invalidate(scope: { userId?: string; roleId?: string; policyId?: string }): Promise<void>;
}
```

### 6.6 Integration in Endpoints

**Decorator-basiert für Standard-CRUD:**
```typescript
@Controller('projects')
export class ProjectsController {
  @Get()
  @Can('read', 'Project')
  async list(@Ability() ability: AppAbility) {
    const where = accessibleBy(ability, 'read').Project;
    return this.projectRepo.findMany({ where });
  }

  @Get(':id')
  @Can('read', 'Project')
  async get(@Param('id') id: string, @Ability() ability: AppAbility) {
    const project = await this.projectRepo.getOrThrow(id);
    ForbiddenError.from(ability).throwUnlessCan('read', project);
    return project;
  }

  @Patch(':id')
  @Can('update', 'Project')
  async update(@Param('id') id: string, @Body() dto: UpdateDto, @Ability() ability: AppAbility) {
    const project = await this.projectRepo.getOrThrow(id);
    ForbiddenError.from(ability).throwUnlessCan('update', project);
    // Field-Level: filter dto auf permittedFields
    const allowed = permittedFieldsOf(ability, 'update', project);
    const filtered = pick(dto, allowed);
    return this.projectRepo.update(id, filtered);
  }
}
```

**Custom-Logic (außerhalb Standard-CRUD):**
```typescript
async approveProject(id: string, user: User) {
  const project = await this.projectRepo.getOrThrow(id);
  await this.permissions.authorize(user, 'approve', project);   // wirft 403 wenn nicht erlaubt
  // ... approval logic
}
```

**Vorteil gegenüber Eigenbau:** CASL ist seit Jahren in Production, hat eingebaute Edge-Case-Handling (z.B. mehrere Rules für gleiches Subject werden korrekt OR-verknüpft), Field-Permissions, Inverse-Rules. Wir bauen kein Permission-Framework, sondern nur die Persistenz-Schicht (DB-Modell) + Resolver (DB-Rule → CASL-Rule).

### 6.7 Caching & Invalidation
- LRU-Cache pro `userId` mit TTL (default 60s, configurable, 0 = aus)
- Invalidation via `permissions.invalidate(userId | roleId | policyId)` Event
- Bei `Role.update / Policy.update / Permission.update` automatische Cache-Clearance

### 6.8 System-Rollen (Bootstrap)
| Rolle | Beschreibung |
|---|---|
| `Administrator` | `isSystem=true`, bypasst alle Checks. Erste User wird automatisch Admin |
| `Public` | `isPublic=true`, gilt für alle nicht-eingeloggten Requests |

System-Rollen sind nicht löschbar. Permissions können erweitert werden, aber `Administrator` bleibt Bypass.

### 6.9 Admin-UI-Endpoints (für ein zukünftiges Admin-Panel)
- `GET /admin/roles`
- `POST /admin/roles`
- `GET /admin/policies`
- `POST /admin/policies`
- `GET /admin/permissions?policyId=...`
- `POST /admin/permissions`
- `GET /admin/permissions/test` – simuliert eine Action für einen User

---

## 7. Response-Pipeline & Output-Filtering

CASL deckt Read-Visibility (Item-Filter) und statische Field-Whitelists ab. Für **instanz-abhängige Filterung** (Masking, Cross-Lookups, computed Visibility) brauchen wir eine programmatische Schicht. Diese ist als 4-Stufen-Pipeline organisiert, die der bewährten Architektur des alten nest-server entspricht — angepasst an Plain-Objects + DI statt Klassen-Models.

### 7.1 Architektur-Überblick

```
Service/Repository returns Plain-Object(s) from Prisma
  ↓
Stage 1: Hydration (optional)
  ↓ — Zod-Parse-Schemas zur Type-Validation
Stage 2: i18n-Translate
  ↓ — _translations auf Felder anwenden basierend auf Accept-Language
Stage 3a: CASL Field-Whitelist
  ↓ — permittedFieldsOf(ability, 'read', item) → strip nicht erlaubte
Stage 3b: Filter-Service (Per-Instance)
  ↓ — Resource-spezifischer Service: Masking, Cross-Lookups, computed
Stage 4: Secret-Safety-Net
  ↓ — Last-Resort-Strip global definierter Secret-Felder
HTTP-Response
```

**Implementiert als globaler `OutputPipelineInterceptor`** (NestJS `APP_INTERCEPTOR`). Greift automatisch auf alle Responses, kein Opt-in pro Endpoint nötig.

### 7.2 Filter-Service Pattern (Stage 3b)

Pro Resource ein **Filter-Service** mit `@FilterFor()`-Decorator. Volle DI-Power für Cross-Lookups, sauber von Repository getrennt, NestJS-Standard-Mechanismus.

```typescript
// src/modules/users/users.filter.service.ts
import { FilterFor, ResourceFilter, FilterContext } from '@/core/permissions';
import type { User } from '@prisma/client';
import { TenantService } from '@/core/tenancy';
import { maskPhone } from '@/core/common/mask';

@FilterFor('User')
@Injectable()
export class UserFilterService implements ResourceFilter<User> {
  constructor(private readonly tenantService: TenantService) {}

  async applyInstance(user: User, ctx: FilterContext): Promise<User | null> {
    // Self oder Admin → unverändert
    if (ctx.user?.id === user.id || ctx.user?.roles.includes('admin')) {
      return user;
    }

    // PhoneNumber maskieren statt strippen — Frontend braucht visuellen Indikator
    if (user.phoneNumber) {
      user.phoneNumber = maskPhone(user.phoneNumber);
    }

    // Cross-Lookup: Tenant-Membership-Status checken (DI macht's möglich)
    const sameTenant = await this.tenantService.shareTenant(ctx.user?.id, user.id);
    if (!sameTenant) {
      user.email = null as any;
    }

    return user;     // null = Item komplett aus Response entfernen
  }
}
```

**Auto-Discovery:** `@FilterFor('User')` registriert den Service in der globalen `FilterRegistry`. Der `OutputPipelineInterceptor` zieht den passenden Filter aus der Registry für jedes Subject in der Response (rekursiv für nested Objects).

### 7.3 Filter-Service Interface

```typescript
export interface ResourceFilter<T> {
  /**
   * Per-Instance-Hook für komplexe Output-Logik.
   * Wird AFTER CASL-Field-Whitelist aufgerufen (CASL hat statische Felder schon entfernt).
   *
   * @returns gefiltertes Objekt, oder null um es aus der Response zu werfen
   */
  applyInstance?(item: T, ctx: FilterContext): Promise<T | null> | T | null;

  /**
   * Optional: Fields-Hook für vereinfachte Field-Strip-Logik.
   * Alternative zu applyInstance wenn nur Felder geändert werden.
   */
  fieldsToStrip?(item: T, ctx: FilterContext): string[];
}

export interface FilterContext {
  user: User | null;
  ability: AppAbility;
  tenantId?: string;
  tenantRole?: string;
  language: string;
  /** Parent-Resource bei verschachtelten Outputs */
  parent?: { type: string; data: any };
}
```

### 7.4 Stage 4: Secret-Safety-Net

Last-Resort-Schutz. Auch wenn ein Filter vergessen wurde oder Permissions versehentlich Secrets erlauben, werden diese Felder **immer** entfernt.

**Globale Default-Liste** (in `core/permissions/secret-safety.ts`):
```typescript
export const DEFAULT_SECRET_FIELDS = [
  // Auth
  'password', 'passwordHash', 'passwordResetToken', 'verificationToken',
  // Sessions
  'refreshToken', 'refreshTokens', 'sessionToken', 'tempToken',
  // 2FA
  'totpSecret', 'twoFactorSecret', 'backupCodes',
  // API-Keys
  'keyHash', 'apiSecret',
  // Webhooks
  'webhookSecret',
];
```

**Pattern-basiertes Stripping** (zusätzlich, immer aktiv):
- Felder die auf `*Hash`, `*Secret`, `*Token` enden (case-insensitive)
- Konfigurierbar via ENV `SECRET_FIELD_PATTERNS`

**Resource-Override:**
```typescript
@FilterFor('User')
export class UserFilterService implements ResourceFilter<User> {
  // Zusätzliche Secret-Felder spezifisch für User
  static readonly extraSecretFields = ['internalNotes'];
}
```

**Encrypted Felder (Kap. 13)** sind automatisch im Secret-Safety-Net — entweder werden sie entschlüsselt zurückgegeben (wenn Permission ok) oder durch das Pipeline-Stripping entfernt. Niemals Cipher-Text in Responses.

### 7.5 Reihenfolge-Garantien & Performance

**Reihenfolge ist kritisch:**
1. Translate **vor** Field-Whitelist (sonst werden `_translations` versehentlich gestrippt)
2. CASL-Field-Whitelist **vor** Filter-Service (Filter sieht nur erlaubte Felder, einfachere Logik)
3. Secret-Safety-Net **zuletzt** (egal was vorher passiert ist, Secrets sind weg)

**Performance:**
- Pipeline läuft pro Item, nicht pro Request — bei Listen-Responses einmal pro Element
- Filter-Services werden parallel via `Promise.all()` ausgeführt wenn unabhängig
- Cache: pro Request wird `permittedFieldsOf()` einmal pro Subject-Type gecached (Stage 3a)
- Skip-Marker: Item mit `_skipPipeline = true` umgeht alle Stages (für interne System-Responses)

### 7.6 Vergleich zur alten `securityCheck`-Architektur

| Alt (nest-server) | Neu (Plan) |
|---|---|
| `CoreModel.securityCheck(user, force)` Method | `FilterService.applyInstance(item, ctx)` |
| `@Restricted` Class/Field-Decorator | CASL-Rules (DB-konfigurierbar) |
| `CheckResponseInterceptor` für Restricted-Filter | CASL `permittedFieldsOf()` in Stage 3a |
| `CheckSecurityInterceptor` mit Secret-Liste | Secret-Safety-Net in Stage 4 |
| `ResponseModelInterceptor` (Plain → Model) | nicht nötig (Plain-Objects bleiben Plain) |
| `TranslateResponseInterceptor` | Stage 2 (i18n-Translate) |

**Was wir gewinnen:**
- CASL als Industry-Standard statt Eigenbau
- DB-konfigurierbare Permissions (Decorator-Refactor → Migrations-only)
- Filter-Logik mit DI (Cross-Service-Calls möglich)
- Plain-Objects + Funktionaler Stil passt zu Prisma

**Was bleibt gleich:**
- 4-Stage-Pipeline mit Defense-in-Depth
- Pro-Instance-Filter für komplexe Cases
- Secret-Safety-Net unabhängig von Auth-Logik

### 7.7 Konfiguration

```typescript
// core/permissions/output-pipeline.config.ts
export interface OutputPipelineConfig {
  // Stages aktivieren/deaktivieren (default alle aktiv)
  stages?: {
    translate?: boolean;
    caslFieldWhitelist?: boolean;
    filterService?: boolean;
    secretSafetyNet?: boolean;
  };
  // Globale Secret-Felder ergänzen
  additionalSecretFields?: string[];
  // Pattern-basiertes Stripping
  secretFieldPatterns?: RegExp[];
  // Debug: log wenn Pipeline ein Feld entfernt
  debug?: boolean;
}
```

ENV-driven für Production-Hardening:
```bash
SECRET_FIELD_PATTERNS=".*Hash$,.*Token$,.*Secret$"
PIPELINE_DEBUG=false
```

---

## 8. File-Handling (Directus-Style)

> **Aktivierung:** default ON via `features.files.enabled = true`. Bei Apps ohne Files (z.B. reine API-Server, Backoffice-Tools ohne User-Uploads) auf `false` setzen — entfernt File/Folder-Modelle, Upload-Routes, TUS-Endpunkte, sharp-Dependency.

### 7.1 Architektur
- **DB-Modell `File`** mit Metadaten (filename, mime, size, dimensions, checksum, location, folder, uploadedBy, …)
- **Storage-Adapter-Pattern** – pluggable
- **Default-Adapter: RustFS** (S3-API-kompatibel, self-hosted) – konfiguriert via ENV
- **Folder-System** in DB (Hierarchie via parent-child)
- **On-the-fly Image-Transformations** mit Disk-Cache
- **TUS Resumable Upload** + direkter Multipart-Upload
- **Permissions auf File-Ebene** via Standard-Permission-System (resource: `files`)

### 7.2 Datenmodell
```prisma
model FileFolder {
  id          String   @id @default(uuid()) @db.Uuid
  name        String
  parentId    String?  @db.Uuid
  parent      FileFolder?  @relation("FolderHierarchy", fields: [parentId], references: [id])
  children    FileFolder[] @relation("FolderHierarchy")
  files       File[]
  tenantId    String?  @db.Uuid       // optional tenant-scope
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([parentId, name, tenantId])
}

model File {
  id              String   @id @default(uuid()) @db.Uuid
  // Identity
  filename        String                          // generierter Storage-Name
  filenameDownload String                         // Original-Name für Downloads
  title           String?
  description     String?
  // Metadata
  mimeType        String
  filesize        BigInt
  width           Int?
  height          Int?
  duration        Int?                            // Audio/Video in ms
  checksum        String                          // sha256
  // Storage
  storage         String                          // Adapter-Key, z.B. "s3-default"
  storageKey      String                          // Pfad/Key im Backend
  // Organisation
  folderId        String?  @db.Uuid
  folder          FileFolder? @relation(fields: [folderId], references: [id])
  tags            String[]
  // Access
  isPublic        Boolean  @default(false)        // public access ohne Token
  // Audit
  uploadedBy      String?  @db.Uuid
  tenantId        String?  @db.Uuid
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  // Custom Metadata (extensible)
  metadata        Json?
  @@index([folderId])
  @@index([tenantId])
  @@index([uploadedBy])
}
```

### 7.3 Storage-Adapter-Interface
```typescript
export interface StorageAdapter {
  readonly name: string;
  put(key: string, stream: Readable, opts: PutOptions): Promise<PutResult>;
  get(key: string): Promise<Readable>;
  head(key: string): Promise<HeadResult>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  copy(srcKey: string, dstKey: string): Promise<void>;
  signedUrl(key: string, opts: SignedUrlOptions): Promise<string>;  // optional
}
```

### 7.4 Eingebaute Adapter
Genau **drei** Adapter werden unterstützt:

| Adapter | Use-Case | Empfohlen für |
|---|---|---|
| `s3` | RustFS (Default-Backend), AWS S3, Cloudflare R2, Backblaze B2 | Production / Staging, alle Filegrößen |
| `local` | Filesystem auf der App-Instanz | Dev, Single-Node-Setups, kleine Installationen |
| `postgres` | Speicherung in der Main-DB (siehe 7.4.1) | Kleine Files, Konfigurations-Anhänge, Setups ohne externes Storage |

Beliebig viele Adapter-Instanzen parallel konfigurierbar – z.B. `s3-public` und `s3-private` mit unterschiedlichen Buckets, oder `local` für Logos und `s3` für User-Uploads.

#### 7.4.1 Postgres-Adapter — Implementierungsdetails

**Speicher-Strategie:** Large Objects (`pg_largeobject`) statt `bytea`-Spalten.

| Aspekt | Large Objects (`pg_largeobject`) | `bytea`-Spalte |
|---|---|---|
| Max-Größe | 4 TB pro Objekt | 1 GB Row-Limit (praktisch < 100 MB) |
| Streaming | ja (`lo_open` + `lo_read`) | nein, vollständiger Memory-Load |
| Memory-Footprint | konstant (Chunk-Reads) | Filesize wird im RAM gehalten |
| API | Prisma raw + `lo_*` Functions | Prisma-Native |
| Cleanup | Pflicht (`lo_unlink` bei Delete) | automatisch via Cascade |

Datenmodell (separate Tabelle, **nicht** in `File` direkt):
```prisma
model FileBlob {
  id        String   @id @default(uuid()) @db.Uuid
  fileId    String   @unique @db.Uuid           // → File.id
  loid      BigInt                              // pg_largeobject OID
  size      BigInt
  checksum  String                              // sha256
  createdAt DateTime @default(now())
}
```

**Adapter-Verhalten:**
- `put()` → erstellt Large Object via `lo_create()`, streamt Chunks via `lowrite()`, speichert OID in `FileBlob.loid`
- `get()` → öffnet Large Object via `lo_open()`, streamt via `loread()`, exposed als Node-Readable
- `delete()` → `lo_unlink(loid)` + `FileBlob`-Row löschen
- `head()` → liest `FileBlob.size / checksum` ohne Blob-Load
- `signedUrl()` **nicht unterstützt** – Postgres-Adapter kann keine direkten URLs ausstellen, Downloads gehen immer durch den `/assets/:id`-Endpoint

**Limits & Empfehlungen:**
- **Default-Filesize-Limit für Postgres-Adapter: 50 MB** (per Folder-Config überschreibbar)
- Bei Setups mit > ~10 GB Gesamtdatenvolumen: auf S3 wechseln (Backup-Größe + DB-Performance)
- Backup-Strategie: `pg_dump` mit `-b` (Large Objects inkludieren)
- RLS auf `FileBlob`-Tabelle aktivieren, damit Cross-Tenant-Reads via raw `lo_read` blockiert werden

### 7.5 Konfiguration (ENV)
```bash
# Default-Adapter (welcher Adapter beim Upload genutzt wird, wenn kein expliziter angegeben ist)
STORAGE_DEFAULT=s3-default

# --- S3-Adapter (RustFS-Default / AWS / R2 / B2) ---
STORAGE_S3_DEFAULT_DRIVER=s3
STORAGE_S3_DEFAULT_ENDPOINT=http://rustfs:9000
STORAGE_S3_DEFAULT_REGION=us-east-1
STORAGE_S3_DEFAULT_BUCKET=files
STORAGE_S3_DEFAULT_KEY=...
STORAGE_S3_DEFAULT_SECRET=...
STORAGE_S3_DEFAULT_FORCE_PATH_STYLE=true

# --- Local-Adapter ---
STORAGE_LOCAL_DRIVER=local
STORAGE_LOCAL_ROOT=./storage

# --- Postgres-Adapter (Main-DB) ---
# Nutzt automatisch DATABASE_URL, keine separaten Credentials nötig
STORAGE_PG_DRIVER=postgres
STORAGE_PG_MAX_FILE_SIZE=52428800   # 50 MB Default-Limit
```

### 7.6 Endpunkte
| Method | Path | Description |
|---|---|---|
| `POST` | `/files` | Multipart-Upload (single/multi) |
| `POST` | `/files/import` | Import via URL |
| `GET` | `/files` | Liste (paginated, filterbar via Permissions) |
| `GET` | `/files/:id` | Metadaten |
| `PATCH` | `/files/:id` | Metadaten ändern |
| `DELETE` | `/files/:id` | File löschen (auch im Storage) |
| `GET` | `/assets/:id` | Binary-Download mit Transform-Params |
| `GET` | `/assets/:id/:filename` | Wie oben, aber mit Filename in URL (SEO) |
| `POST` | `/files/folders` | Folder anlegen |
| `GET` | `/files/folders` | Folder-Tree |
| TUS | `/tus/*` | Resumable Upload Endpoint |

### 7.7 Asset-URL & Transformations
URL-Format: `/assets/:id?key=preset|transform-params`

Parameter:
- `width`, `height`, `quality` (1-100), `format` (jpg|png|webp|avif|auto)
- `fit` (cover|contain|inside|outside)
- `withoutEnlargement` (bool)
- `transforms` (Array von Sharp-Operationen, Admin-only)

**Presets** (in DB konfigurierbar) — Mapping `key → params`, sodass URLs nicht alle Parameter explizit ausweisen müssen:
```prisma
model AssetPreset {
  id      String  @id @default(uuid()) @db.Uuid
  key     String  @unique           // z.B. "thumbnail", "card-image"
  params  Json                      // { width: 300, fit: "cover", quality: 80 }
}
```

**Caching:**
- Transformierte Files werden auf Disk gecacht (LRU mit Größen-Limit)
- Cache-Key = `sha256(fileId + params)`
- Cache-Invalidation bei File-Update

### 7.8 Sicherheit
- **Mime-Type-Whitelist** pro Folder konfigurierbar
- **Max-Filesize** global + pro Folder
- **Magic-Byte-Validation** (kein blindes Vertrauen auf Mime-Header)
- **Antivirus-Hook** optional (ClamAV-Integration)
- **Public-Files** explizit über `isPublic`-Flag, sonst Permission-Check
- **Signed URLs** für temporären Public-Access (TTL, max 7 Tage)
- **Path-Traversal-Schutz** (Storage-Keys werden generiert, niemals user-supplied)
- **Permission-Integration** über `resource: 'files'`, Item-Filter werkt auf File-Tabelle

---

## 9. Email

> **Aktivierung:** default ON via `features.email.enabled = true`. Bei Apps ohne ausgehende Mails auf `false` setzen — Better-Auth-Email-Verifikation muss dann ebenfalls deaktiviert werden.

### 8.1 Treiber
- **Nodemailer** (SMTP) – Dev/Test/optional Production
- **Brevo SDK** – Production-Default für transaktionale Mails (Template-IDs)

### 8.2 Templates
- **EJS** für selbstgehostete Templates
- **Brevo-Templates** für Brevo-Versand (Template-ID statt EJS)
- Locale-Fallback-Chain: `<name>-<locale>.ejs` → `<name>.ejs` → Framework-Default
- Eingebaute Templates: `email-verification`, `password-reset`, `welcome`, `invitation`, `password-changed`

### 8.3 API
```typescript
@Injectable()
export class EmailService {
  send(opts: SendOptions): Promise<SendResult>;
  sendTemplate(opts: SendTemplateOptions): Promise<SendResult>;
  // Auto-routes an Brevo, wenn Brevo-Template-ID gesetzt, sonst SMTP+EJS
}
```

### 8.4 Sicherheit
- Versand-Whitelist für Dev (z.B. nur `*@example.com`)
- Rate-Limit pro Empfänger
- SPF/DKIM-Aware (über Brevo)
- Bounce-Handling (Brevo-Webhook → User-Email-Blocklist)

---

## 10. Webhooks (Outgoing)

> **Aktivierung:** opt-in via `features.webhooks.enabled = true` (default off). Aktiviert das Modul, registriert Routes, fügt Migrations für `WebhookEndpoint`/`WebhookDelivery` hinzu. Benötigt aktive Job-Queue + Outbox.

Standardisiertes System, mit dem externe Systeme über Events im Backend benachrichtigt werden — Signatur, Retries, Replay-Protection, Delivery-Log.

### 9.1 Architektur
Pipeline:
```
Domain-Event → OutboxEvent (in DB-Tx)
            → pg-boss-Worker
            → WebhookDispatcher
            → Subscriptions auflösen → HTTP-POST mit HMAC
            → WebhookDelivery-Log
            → Retry mit Exponential-Backoff bei Failure
```

### 9.2 Datenmodell
```prisma
model WebhookEndpoint {
  id           String   @id @default(uuid()) @db.Uuid
  tenantId    String?  @db.Uuid           // null = global / system
  url          String
  description  String?
  // HMAC-Secret für Signatur (encrypted-at-rest, siehe Kap. 12)
  secret       String                     // verschlüsselt
  // Subscription auf Event-Types (z.B. ['project.*', 'user.created'])
  events       String[]
  // Lifecycle
  enabled      Boolean  @default(true)
  // Filterung (optional, JSON-Filter-Rule wie Permissions)
  filter       Json?
  // Health-Tracking
  lastSuccessAt DateTime?
  lastFailureAt DateTime?
  consecutiveFailures Int @default(0)
  // Wenn Failure-Schwelle überschritten → auto-disable
  autoDisableThreshold Int @default(20)
  createdBy    String?  @db.Uuid
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  deliveries   WebhookDelivery[]
  @@index([tenantId])
}

model WebhookDelivery {
  id           String   @id @default(uuid()) @db.Uuid
  endpointId   String   @db.Uuid
  endpoint     WebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)
  eventId      String   @db.Uuid                 // → OutboxEvent.id
  eventType    String
  payload      Json
  // Result
  status       DeliveryStatus @default(PENDING)
  attempts     Int      @default(0)
  responseStatus Int?
  responseBody String?  @db.Text
  lastError    String?
  // Timing
  scheduledAt  DateTime @default(now())
  deliveredAt  DateTime?
  nextAttemptAt DateTime?
  @@index([endpointId, status])
  @@index([scheduledAt])
}
enum DeliveryStatus { PENDING DELIVERING DELIVERED FAILED EXPIRED }
```

### 9.3 Signatur (HMAC-SHA256)
Header beim Outbound-Request:
```
Webhook-Signature: t=1714316400,v1=<hex-hmac-sha256>
Webhook-ID: <delivery-id>
Webhook-Timestamp: 1714316400
Webhook-Event: project.created
```
Signatur-Input: `${timestamp}.${requestBody}`, Schlüssel = Endpoint-Secret.
Replay-Protection: Konsumenten verwerfen Requests mit `|now - timestamp| > 5min`.
Format folgt [Webhook-Standards (Svix-Pattern)](https://www.standardwebhooks.com/).

### 9.4 Retry-Strategie
Exponential-Backoff: `1m, 5m, 15m, 1h, 6h, 24h` (max 6 Versuche, ~ 30h Window).
Nach `autoDisableThreshold` consecutive failures → Endpoint wird auto-disabled, Admin-Notification.
2xx-Response → DELIVERED. 410 Gone → permanent FAILED ohne Retry. Sonst → Retry.

### 9.5 Endpunkte
| Method | Path | Beschreibung |
|---|---|---|
| `GET` | `/webhooks` | Eigene Endpoints listen |
| `POST` | `/webhooks` | Endpoint anlegen (Secret wird einmalig zurückgegeben) |
| `PATCH` | `/webhooks/:id` | URL/Events/Filter ändern |
| `DELETE` | `/webhooks/:id` | Endpoint entfernen |
| `POST` | `/webhooks/:id/rotate-secret` | Secret rotieren |
| `GET` | `/webhooks/:id/deliveries` | Lieferungs-Historie |
| `POST` | `/webhooks/:id/deliveries/:deliveryId/redeliver` | Manuelles Re-Deliver |
| `GET` | `/webhooks/events` | Liste aller registrierten Event-Types |

### 9.6 Event-Registry
Module registrieren ihre Events deklarativ:
```typescript
@WebhookEvent({
  type: 'project.created',
  description: 'Projekt wurde angelegt',
  payloadSchema: ProjectCreatedSchema,           // Zod
})
async onProjectCreated(...) { ... }
```
Auto-Eintrag in `/webhooks/events`-Discovery-Endpoint, OpenAPI-Doku der Payloads.

---

## 11. Search (Postgres Full-Text-Search)

> **Aktivierung:** opt-in via `features.search.enabled = true` (default off). Aktiviert `@Searchable`-Decorator, FTS-Migration-Generator und `/search`-Endpoints. Resources, die nicht `@Searchable` sind, werden nicht indiziert.

Modulare Volltextsuche über mehrere Resources, basierend auf Postgres FTS — keine zusätzliche Infrastruktur.

### 10.1 Architektur
Pro searchable Resource:
1. `searchVector` (`tsvector`) als **generated column** in der Tabelle
2. **GIN-Index** auf der Spalte
3. **Searchable-Config**: welche Felder, mit welcher Gewichtung (A/B/C/D)
4. **Multi-Language**: `regconfig`-Spalte (`'german'`, `'english'`, `'simple'`) – default aus Tenant- oder User-Locale

### 10.2 Schema-Beispiel
```prisma
model Project {
  id           String   @id @default(uuid()) @db.Uuid
  name         String
  description  String?
  // Search-Vector als generated column (via raw SQL Migration)
  // searchVector tsvector GENERATED ALWAYS AS (
  //   setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
  //   setweight(to_tsvector('simple', coalesce(description, '')), 'B')
  // ) STORED
  // GIN-Index: CREATE INDEX projects_search_idx ON projects USING gin(search_vector);
}
```

### 10.3 Searchable-Config
```typescript
@Searchable({
  resource: 'projects',
  fields: [
    { name: 'name', weight: 'A' },
    { name: 'description', weight: 'B' },
    { name: 'tags', weight: 'C' },
  ],
  language: 'simple',                       // oder 'german', 'english', dynamisch via context
  permissionResource: 'projects',           // für Permission-Filter
})
export class Project { ... }
```
Provider erzeugt automatisch die Migration (generated column + GIN-Index).

### 10.4 Service-API
```typescript
@Injectable()
export class SearchService {
  async query(opts: SearchQuery): Promise<SearchResult>;
  async crossSearch(opts: CrossSearchQuery): Promise<CrossSearchResult>;  // mehrere Resources gleichzeitig
}
```

### 10.5 REST-Endpunkte
| Method | Path | Beschreibung |
|---|---|---|
| `GET` | `/search?q=...&types=projects,files&limit=20` | Cross-Resource-Search |
| `GET` | `/search/projects?q=...` | Resource-spezifisch |

Response:
```json
{
  "data": [
    {
      "_type": "projects",
      "_score": 0.873,
      "_highlight": { "name": "Hello <mark>World</mark>" },
      "id": "...", "name": "Hello World", "description": "..."
    }
  ],
  "meta": { "total": 42, "took": "12ms" }
}
```

### 10.6 Features
- **Phrase-Search:** `"hello world"` → `phraseto_tsquery`
- **Prefix-Match:** `hell*` → `:*`-Suffix
- **Boolean:** `hello AND NOT world`
- **Highlight:** via `ts_headline`
- **Ranking:** `ts_rank_cd` mit Resource-spezifischen Boost-Faktoren
- **Permission-Aware:** Resultset wird durch `PermissionService.itemFilter` gefiltert
- **Tenant-Scope:** automatisch via RLS

### 10.7 Limits & Skalierungsstrategie
- Postgres FTS reicht für ~ Millionen Records mit guter Performance
- Bei > 10M Records / Komplex-Queries / Faceting: Migration auf **Meilisearch** oder **Typesense** als Sidecar
- Searchable-Abstraktion bleibt gleich, nur Driver tauscht aus

---

## 12. Realtime (Postgres LISTEN/NOTIFY + Socket.IO)

> **Aktivierung:** opt-in via `features.realtime.enabled = true` (default off). Aktiviert Socket.IO-Gateway, LISTEN-Connection-Pool und Auto-Subscription pro User/Tenant. Benötigt aktive Job-Queue für NOTIFY-Trigger via Outbox.

Bidirektionaler Realtime-Layer ohne externes Pub/Sub-System.

### 11.1 Architektur
```
Service-Operation
  → DB-Insert + Outbox-Eintrag (Tx)
  → pg-boss-Worker
  → NOTIFY <channel>, <json-payload>
  → RealtimeService (LISTEN-Connection)
  → Socket.IO Adapter
  → Client (Socket.IO-Client) in entsprechenden Rooms
```

**Multi-Instance-tauglich:** Jede App-Instanz hat eine eigene `LISTEN`-Connection — Postgres broadcasted an alle Listener. Socket.IO-Sticky-Sessions via `socket.io-redis-adapter` **nicht** nötig, da Postgres die Cross-Instance-Synchronisation übernimmt.

### 11.2 Channel-Schema
| Channel | Bedeutung | Subscriber |
|---|---|---|
| `tenant:${tenantId}:${resource}` | Resource-Updates pro Tenant | Tenant-Mitglieder mit READ-Permission |
| `user:${userId}` | User-spezifische Notifications | nur dieser User |
| `resource:${type}:${id}` | Updates auf einzelnem Item | abonnenten mit READ-Permission auf Item |

Postgres-Channel-Limits: 8000 Bytes pro NOTIFY → großer Payload geht nicht direkt. Pattern: NOTIFY mit nur `{ channel, eventId, type }`, Client holt Detail via REST-API ODER Server schickt vollen Payload nur über Socket.IO (NOTIFY ist nur Trigger).

### 11.3 Socket.IO-Setup
Auth-Handshake:
- Cookie-basiert (Better-Auth-Session) ODER Bearer-Token
- Beim `connection`-Event: User-Identifikation, Tenant-Membership-Prüfung, automatische Room-Subscription auf `user:${userId}` und `tenant:${activeTenantId}:*`

Client-API (Frontend):
```typescript
const socket = io({ withCredentials: true });
socket.emit('subscribe', { resource: 'projects', id: 'abc' });
socket.on('event', (e) => { /* { type: 'project.updated', resource, id, payload } */ });
```

Server-Decorator für Subscription-Permission:
```typescript
@RealtimeChannel({
  pattern: 'resource:projects:*',
  permission: { resource: 'projects', action: 'READ' },
})
export class ProjectsRealtime { ... }
```

### 11.4 Datenmodell
Keine zusätzliche Tabelle nötig — alles läuft über bestehende `OutboxEvent`-Pipeline. Optional:
```prisma
model RealtimeSubscription {
  id        String   @id @default(uuid()) @db.Uuid
  socketId  String
  userId    String   @db.Uuid
  channel   String
  createdAt DateTime @default(now())
  @@index([socketId])
  @@index([userId])
}
```
(Nur wenn Subscription-State server-seitig sichtbar sein soll — sonst zustandslos im Memory.)

### 11.5 Health & Monitoring
- Connected-Sockets-Count als Prometheus-Metrik
- Postgres-Listen-Connection-Health im `/health/ready`
- Heartbeat: Server schickt alle 30s `ping`, Client antwortet `pong` — sonst Disconnect

---

## 13. Mobile-Offline-Sync (PowerSync)

> **Aktivierung:** opt-in via `features.powerSync.enabled = true` (default off). Aktiviert den Upload-Controller, lädt PowerSync-Konfiguration, fügt JWT-Audience `powersync` zu Better-Auth hinzu. Benötigt zusätzlich: Postgres logical replication, PowerSync-Service-Container, Sync-Rules-File. **Wenn off:** keinerlei Postgres-Replication-Overhead, kein zusätzlicher Container, normaler Better-Auth-JWT ohne extra Audience.

Offline-First-Funktionalität für **React-Native**- und **Flutter**-Apps via [PowerSync](https://www.powersync.com). Ergänzt — nicht ersetzt — den Realtime-Layer (Kap. 12, der primär für Web-Clients gedacht ist).

### 13.1 Was PowerSync löst

| Problem | Ohne PowerSync | Mit PowerSync |
|---|---|---|
| App offline → Daten lesen | nicht möglich | volle SQLite-Datenbank lokal |
| App offline → Schreibungen | verloren | queued, sync bei Reconnect |
| Echtzeit-Updates auf Mobile | per Polling oder Socket.IO (Battery-drain) | Push via WebSocket, Differential-Sync |
| Konflikt-Resolution | manueller Eigenbau | Server-Wins-Default + Custom-Logic |
| Cross-Device-Sync | App-State-Replikation aufwändig | "kostenlos" durch zentrale Postgres |

### 13.2 Architektur

```
┌─────────────────┐    Postgres WAL    ┌──────────────────┐
│   Postgres      │ ─────────────────▶ │ PowerSync Service│
│   (Source of    │   (logical replic.)│ (Sync-Engine)    │
│    Truth)       │                    │                  │
└─────────────────┘                    └──────────────────┘
        ▲                                       │
        │                            Sync-Buckets
        │ Writes via REST            (per User/Tenant)
        │ (Better-Auth JWT)                     │
        │                                       ▼
        │                              ┌──────────────────┐
        │                              │  Native App      │
        └──────────────────────────────│  + SQLite local  │
              (Permission-Check)       └──────────────────┘
```

**Drei Komponenten:**
1. **Postgres** als Single Source of Truth (logical replication aktiviert)
2. **PowerSync Service** — Self-Hosted-Container oder PowerSync Cloud
   - Liest Postgres-WAL via Logical Replication
   - Berechnet Sync-Buckets pro Client basierend auf Sync-Rules
   - Streamt Differential-Updates via WebSocket zu Clients
3. **Client** (React Native via `@powersync/react-native`)
   - Lokale SQLite-DB (auto-managed)
   - Reactive Queries via `useQuery()` Hooks
   - Schreibungen lokal queued → uploaded via REST-API zum Backend (durchläuft normale Permission-Checks)

**Wichtig:** PowerSync **liest** direkt aus Postgres-WAL, **schreibt aber nicht direkt**. Schreibungen gehen den normalen Weg über unsere REST-API (mit CASL, Validation, Audit). PowerSync ist nur der Read-Pfad — Defense-in-Depth bleibt erhalten.

### 13.3 Sync-Rules (zentrale Konfiguration)

Sync-Rules definieren **welcher Client welche Daten** bekommt. YAML-basiert, deployed mit dem PowerSync Service.

```yaml
# powersync/sync-rules.yaml
bucket_definitions:

  # User-eigene Daten — gehört nur diesem User
  user_self:
    parameters:
      - SELECT request.user_id() as user_id
    data:
      - SELECT * FROM users WHERE id = bucket.user_id
      - SELECT * FROM api_keys WHERE user_id = bucket.user_id

  # Pro Tenant ein Bucket — User bekommt Daten aller Tenants in denen er Member ist
  by_tenant:
    parameters:
      - SELECT tenant_id
        FROM tenant_members
        WHERE user_id = request.user_id() AND status = 'active'
    data:
      - SELECT * FROM projects WHERE tenant_id = bucket.tenant_id AND deleted_at IS NULL
      - SELECT * FROM tasks WHERE tenant_id = bucket.tenant_id AND deleted_at IS NULL
      - SELECT * FROM comments WHERE project_id IN (
          SELECT id FROM projects WHERE tenant_id = bucket.tenant_id
        )

  # Public-Daten — unverändert für alle
  public:
    data:
      - SELECT * FROM categories
      - SELECT * FROM asset_presets
```

**Eigenschaften:**
- Sync-Rules sind **read-only Subset** der Permissions (vereinfachte Sicht)
- Sync-Rule-Änderungen erfordern Re-Sync aller Clients (Versions-Bump)
- Sync-Rules nutzen normale SQL-Conditions, kein eigenes DSL
- `request.user_id()` aus JWT-Claims (Better-Auth liefert)

### 13.4 Auth-Integration mit Better-Auth

PowerSync verifiziert Client-JWTs via JWKS-Endpoint. Better-Auth's JWT-Plugin liefert genau das.

**JWT-Claims** die PowerSync braucht:
- `sub` → User-ID (`request.user_id()`)
- `aud` → muss `powersync` enthalten (konfigurierbar)
- Custom-Claims optional: `tenant_ids`, `roles` für Sync-Rule-Conditions

**Setup:**
```bash
# Better-Auth JWT-Plugin liefert JWKS unter:
GET /api/auth/jwks

# PowerSync Service konfigurieren:
POWERSYNC_JWKS_URL=http://api:3000/api/auth/jwks
POWERSYNC_AUDIENCE=powersync
```

Token-Issue beim App-Login:
- App authentifiziert sich normal via Better-Auth (Email/PW oder Passkey)
- Erhält Standard-Session + zusätzlich PowerSync-JWT
- PowerSync-Client connected mit dem JWT
- Token-Refresh läuft transparent über Better-Auth

### 13.5 Write-Pfad (Upload-Queue)

```
App schreibt local SQLite
  → CrudTransaction wird in PowerSync-Upload-Queue gestellt
  → PowerSync-Client sendet Batch an unseren BackendUploadHandler
  → Handler ruft pro CRUD-Op den entsprechenden REST-Endpoint
  → Standard-Auth (JWT) + CASL + Zod + Repository
  → Erfolg → Upload-Queue clear
  → Failure → Retry mit Backoff, oder Konflikt-Resolution
```

**Backend-Endpoint (zentral):**
```typescript
@Controller('powersync')
export class PowerSyncController {
  @Post('crud')
  @Can('use', 'PowerSync')
  async uploadBatch(@Body() ops: CrudOp[], @Ability() ability: AppAbility, @CurrentUser() user) {
    for (const op of ops) {
      switch (op.op) {
        case 'PUT':    await this.handleCreate(op, ability); break;
        case 'PATCH':  await this.handleUpdate(op, ability); break;
        case 'DELETE': await this.handleDelete(op, ability); break;
      }
    }
    return { ok: true };
  }
}
```
Jede Op läuft durch die **gleichen Permission-Checks** wie normale REST-Calls.

### 13.6 Konflikt-Resolution

Default: **Server Wins** (Last-Write-Wins ist Standard, aber Server-Validation ist autoritativ).

Custom-Logic pro Resource möglich via Repository-Hook:
```typescript
@Injectable()
export class ProjectRepository extends BaseRepository<Project> {
  async resolveConflict(localOp: CrudOp, currentServer: Project): Promise<Project | 'reject'> {
    // Beispiel: bei status-Konflikt → Server-Wert behalten und Op rejecten
    if (localOp.data.status !== currentServer.status) {
      return 'reject';
    }
    // Sonst: merge
    return { ...currentServer, ...localOp.data };
  }
}
```

### 13.7 Verhältnis zu anderen Features

| Feature | Verhältnis zu PowerSync |
|---|---|
| **Permissions (Kap. 6, CASL)** | Schreib-Pfad geht durch CASL — keine Sicherheitslücke. Sync-Rules sind read-only Spiegel der READ-Permissions. |
| **Multi-Tenancy + RLS (Kap. 5)** | RLS bleibt für direkte API-Calls aktiv. PowerSync-Service hat eigene DB-Connection (Replication-Role) und nutzt Sync-Rules statt RLS. |
| **Realtime (Kap. 12)** | Komplementär: Socket.IO für Web (Notifications, Live-Counts), PowerSync für Mobile (Datenmodell-Sync). Beide können koexistieren. |
| **Field-Encryption (Kap. 14)** | **Konflikt:** PowerSync würde Cipher-Text syncen — Client kann nicht entschlüsseln (KEK gehört nicht auf Mobile-Geräte). **Lösung:** Encrypted Felder werden in Sync-Rules **explizit ausgeschlossen** und nur via REST-API on-demand mit Decrypt-Permission abrufbar. |
| **Soft-Delete** | Sync-Rules filtern `deleted_at IS NULL` — gelöschte Items werden vom Client entfernt. Hard-Delete triggert PowerSync-WAL-Event. |
| **File-Handling (Kap. 8)** | **Files NICHT via PowerSync** (zu groß, falsches Tool). Stattdessen: File-Metadaten werden synced, der Binary kommt über S3-Direct-Download (signed URL via API). Lokales Caching im Client-Storage. |
| **Audit-Log (Kap. 16)** | Mobile-Writes erscheinen normal im Audit-Log (laufen ja durch unsere API). |
| **Webhooks (Kap. 10)** | Keine Interaktion — Webhooks fired wie sonst auch. |

### 13.8 Datenmodell-Pflicht

PowerSync verlangt für jede synced Tabelle:
- **Primary-Key** als **UUID v4 oder v7** (kein Auto-Increment-Int)
- Spalten kompatibel mit SQLite-Types (TIMESTAMP → ISO-String, JSONB → JSON-String)

Unser Plan erfüllt das (UUID v7 in Kap. 25.9). Prisma-`@map`-Spalten sind unverändert kompatibel.

### 13.9 Postgres-Setup

```sql
-- Logical Replication aktivieren
ALTER SYSTEM SET wal_level = 'logical';
ALTER SYSTEM SET max_wal_senders = 10;
ALTER SYSTEM SET max_replication_slots = 5;

-- Replication-Role für PowerSync
CREATE ROLE powersync_replication WITH REPLICATION LOGIN PASSWORD '<env>';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_replication;

-- Publication für relevante Tabellen
CREATE PUBLICATION powersync FOR TABLE
  users, tenants, tenant_members, projects, tasks, comments, file_metadata;
```

Migration-Skript via Prisma raw-SQL.

### 13.10 Docker-Compose-Erweiterung

```yaml
  powersync:
    image: journeyapps/powersync-service:latest
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      POWERSYNC_DATABASE_URI: postgres://powersync_replication:<pwd>@postgres:5432/app
      POWERSYNC_JWKS_URL: http://app:3000/api/auth/jwks
      POWERSYNC_AUDIENCE: powersync
      POWERSYNC_PORT: 8080
    ports:
      - "8080:8080"
    volumes:
      - ./powersync/sync-rules.yaml:/config/sync-rules.yaml:ro
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8080/probes/liveness"]
      interval: 15s
      timeout: 5s
      retries: 5
```

### 13.11 Client-Setup (React Native)

```typescript
// app/lib/powersync.ts
import { PowerSyncDatabase, AbstractPowerSyncBackend } from '@powersync/react-native';
import { schema } from './powersync-schema';

class Backend extends AbstractPowerSyncBackend {
  async fetchCredentials() {
    const session = await getSession();              // Better-Auth
    return {
      endpoint: 'wss://powersync.example.com',
      token: session.powerSyncJwt,
    };
  }

  async uploadData(database) {
    const batch = await database.getCrudBatch();
    if (!batch) return;
    await api.post('/powersync/crud', { ops: batch.crud });
    await batch.complete();
  }
}

export const db = new PowerSyncDatabase({ schema, database: { dbFilename: 'app.db' } });
db.connect(new Backend());
```

```typescript
// In Component:
const projects = useQuery('SELECT * FROM projects WHERE tenant_id = ?', [activeTenantId]);
// Reactive — UI updated automatisch wenn Sync neue Daten liefert
```

### 13.12 Deployment-Optionen

| Option | Wann |
|---|---|
| **PowerSync Cloud** | Kein Ops-Aufwand, $99/Monat Starter, scale-up | für Greenfield, kleinere Teams |
| **Self-Hosted PowerSync** | Open-Source-Image, Docker-Container | für Compliance / kein Cloud erlaubt |
| **kein PowerSync** | nur wenn keine Mobile-App geplant | Bonsai-Default, nachrüstbar |

PowerSync ist **opt-in** — wenn keine Mobile-App existiert, wird das Modul nicht aktiviert, kostet nichts.

### 13.13 Sicherheit & Compliance

- **JWT-Audience-Validation** verhindert Token-Reuse aus anderen Kontexten
- **Sync-Rules** sind die einzige Source-of-Truth für Read-Visibility am Mobile-Client → strikt mit Permission-System abgleichen
- **Encrypted Felder ausschließen** (siehe 13.7) — niemals Cipher-Text auf Mobile-Devices
- **JWT-Expiry** kurz halten (15 Min) + Refresh über Better-Auth
- **Audit:** Mobile-CRUD-Ops landen wie alle anderen im Audit-Log

### 13.14 Limits

- Sync-Rules-Komplexität: PowerSync evaluiert pro Bucket — komplexe Joins können Performance kosten. Empfehlung: Buckets simpel halten, Joins durch Read-Endpoints abdecken.
- Initial-Sync: bei großen Tabellen (>100k Rows pro User) dauert First-Sync — Strategie: Pagination via Time-Window-Buckets (`SELECT ... WHERE updated_at > NOW() - 30 days`).
- Konflikt-Resolution ist nicht trivial — bei wirklich kollaborativen Use-Cases (gleichzeitige Edits am selben Item) eher CRDT-Lösungen (Y.js, Automerge) erwägen.

---

## 14. Field-Level-Encryption (Application-Level)

> **Aktivierung:** opt-in via `features.fieldEncryption.enabled = true` (default off). Aktiviert die Prisma-Encryption-Extension. Wenn aktiviert: `ENCRYPTION_MASTER_KEY` (32-Byte base64) ist **Pflicht-ENV-Variable**. Bei Verlust dieses Keys sind verschlüsselte Daten unwiederbringlich verloren — Backup-Strategie für KEK ist Pflicht.

Verschlüsselung sensibler Felder (PII, API-Keys, Credentials) auf Application-Layer — Postgres sieht nur Cipher-Text.

### 12.1 Use-Cases
- **PII** (z.B. `phoneNumber`, `address`, `dateOfBirth`)
- **Webhook-Secrets**, **3rd-Party-API-Tokens**
- **Bank-/Payment-Daten** falls relevant
- **Custom-Metadata** mit sensiblen Inhalten

Nicht verschlüsselt: Felder, auf denen Postgres-FK / Index liegen muss (`email` bei Better-Auth, `tenantId`).

### 12.2 Algorithmus
**AES-256-GCM** (NIST-empfohlen, authenticated encryption).
Format pro Feld:
```
v1:<base64(iv)>:<base64(ciphertext+tag)>
```
- `v1` = Key-Version (für Rotation)
- IV: 12 Byte zufällig pro Verschlüsselung
- Tag: 16 Byte GCM-Auth-Tag

### 12.3 Key-Management
- **Master-Key (KEK)** in ENV (`ENCRYPTION_MASTER_KEY`, 32 Byte base64) ODER Secret-Manager
- Operative Keys (DEK) sind für Phase 1 = Master-Key. Rotation-Pfad: KEK ändern → alle Felder in Background-Job neu verschlüsseln (lesen mit alter Version, schreiben mit neuer).
- Production: KEK aus Vault / Doppler / AWS KMS holen
- Dev/Test: hardcoded dummy KEK in Local-Config
- Verlust des KEK = Datenverlust → Backup-Strategie für KEK getrennt von DB

### 12.4 Prisma-Extension
```typescript
@Encrypted()    // Decorator auf Prisma-Property nicht möglich — über Config
const encryptedFields: EncryptionConfig = {
  User: ['phoneNumber', 'dateOfBirth'],
  WebhookEndpoint: ['secret'],
  ApiKey: [],   // Hash, nicht Encrypt
};
```
Extension hooks in `create / update / findMany / findFirst` ein:
- Vor Write: deklarierte Felder verschlüsseln
- Nach Read: deklarierte Felder entschlüsseln
- Bei Decrypt-Fehler: Logging + null zurückgeben (nicht crashen)

### 12.5 Searchable-Encryption (optional, wenn Lookup nötig)
Für Felder, auf denen `WHERE = 'value'` funktionieren muss:
- **Blind-Index**: zusätzliche Spalte `<field>_hash` mit `HMAC-SHA256(value, blindIndexKey)`
- Lookup geht gegen Hash-Spalte, decrypted nur bei Treffer
- Trade-off: Hash-Kollisionen analysierbar (Timing/Frequency) — nur für nicht-sensible Identifier verwenden
- Sinnvoll z.B. für `phoneNumber`-Suche, **nicht** für niedrig-Entropie-Felder wie `gender`

### 12.6 Library-Wahl
- **`@47ng/cloak`** als Default (kompakt, Vault-kompatibel, Versioning eingebaut)
- Alternative: Eigenbau auf Bun/Node `crypto` (~ 80 LOC für die Core-Operationen)

### 12.7 Integration mit Audit-Log
- Audit-Log darf encrypted Felder **nicht im Klartext** loggen
- Automatischer Diff-Filter im Audit-Log: encrypted-Felder werden als `<encrypted>` markiert oder Hash-only gespeichert

---

## 15. Geo & Standortdaten (PostGIS)

> **Aktivierung:** opt-in via `features.geo.enabled = true` (default off). Wenn aktiv: PostGIS-Extension wird via Migration installiert, Geo-Models registriert, `GeoService` + Geocoding-Provider geladen. Wenn inaktiv: PostGIS-Extension fehlt komplett, kein Overhead.

Standortdaten-Funktionalität via [PostGIS](https://postgis.net) — der De-facto-Standard für räumliche Daten in Postgres. Ergänzt unseren Stack um Adressen-Verwaltung, Geocoding, Räumliche Queries (Nearby/Within), Geofencing und GeoJSON-Output.

### 15.1 Architektur

```
Frontend (Mapbox/Leaflet)  ──── GeoJSON ────▶ /api/places/nearby?lat=...&lng=...
                                                       │
                            ┌──────────────────────────┴──────────────────────────┐
                            │                                                     │
                            ▼                                                     ▼
                    GeoService                                       GeocodingProvider (extern)
                    ──────────                                       ─────────────────────────
                    - findNearby()                                   - Mapbox / Google / OSM-Nominatim
                    - withinGeofence()                               - Caching pro Adresse
                    - distance()                                     - Rate-Limiting
                            │
                            ▼
                    Postgres + PostGIS
                    ──────────────────
                    GIST-Indizes auf geometry-Spalten
                    Raw-SQL via prisma.$queryRaw (Prisma kennt PostGIS nicht nativ)
```

### 15.2 PostGIS-Setup

Migration via Prisma raw-SQL:
```sql
-- prisma/migrations/<timestamp>_geo_init/migration.sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;       -- optional, für komplexe Geo-Operations
```

Postgres-Init-Script (Kap. 25.19) wird **nur** ergänzt, wenn Geo-Feature aktiv. Conditional-Schema-Konkatenation aus Kap. 20.4 lädt `prisma/features/geo.prisma`.

### 15.3 Datenmodell

```prisma
// prisma/features/geo.prisma — wird nur geladen wenn Feature aktiv

model Address {
  id               String   @id @default(uuid()) @db.Uuid
  // Strukturierte Felder (mit Encryption für PII)
  street           String
  zip              String
  city             String
  country          String                              // ISO 3166-1 alpha-2 (DE, AT, US, ...)
  state            String?                             // Bundesland/Region
  // Geocoding-Result
  formattedAddress String?                             // vom Provider normalisiert
  location         Unsupported("geometry(Point, 4326)")?
  geocodingProvider String?                            // 'mapbox', 'nominatim', etc.
  geocodedAt       DateTime?
  // Custom-Metadata aus Provider (place_id, components, accuracy, ...)
  metadata         Json?
  // Owner / Tenant
  tenantId         String?  @db.Uuid
  ownedBy          String?  @db.Uuid
  // Audit
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  @@index([country, zip])
  @@index([tenantId])
}

model Geofence {
  id          String   @id @default(uuid()) @db.Uuid
  name        String
  description String?
  area        Unsupported("geometry(Polygon, 4326)")
  // Beispiel-Use-Cases: Liefergebiete, Einsatzgebiete, Service-Zonen
  category    String?                                  // 'delivery_zone', 'service_area', ...
  tenantId    String?  @db.Uuid
  metadata    Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([tenantId])
  @@index([category])
}
```

Spatial-Indizes via raw-SQL-Migration (Prisma kann GIST-Indizes nicht nativ):
```sql
CREATE INDEX addresses_location_idx ON addresses USING GIST (location);
CREATE INDEX geofences_area_idx     ON geofences USING GIST (area);
```

### 15.4 GeoService API

```typescript
@Injectable()
export class GeoService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GEOCODING_PROVIDER) private readonly geocoder: GeocodingProvider,
    private readonly cache: GeocodingCache,
  ) {}

  // === Geocoding (Provider-abstrahiert) ===
  async geocode(input: AddressInput): Promise<GeocodingResult>;
  async reverseGeocode(lat: number, lng: number): Promise<AddressDetails>;

  // === Räumliche Queries ===
  async findNearby<T>(opts: {
    table: string;                  // z.B. 'places'
    lat: number;
    lng: number;
    radiusMeters: number;
    limit?: number;
    where?: Prisma.Sql;             // Zusätzliche Filter (z.B. tenantId)
  }): Promise<Array<T & { distanceMeters: number }>>;

  async withinGeofence(geofenceId: string, point: { lat: number; lng: number }): Promise<boolean>;

  async findGeofencesContaining(point: { lat: number; lng: number }): Promise<Geofence[]>;

  // === Distanz-Berechnung (Haversine via PostGIS-geography) ===
  async distance(a: Point, b: Point): Promise<number>;   // in Metern

  // === Bulk-Geocoding ===
  async geocodeAll(addresses: AddressInput[]): Promise<GeocodingResult[]>;
}
```

### 15.5 Geocoding-Provider-Abstraktion

Analog zu Storage-Adapter (Kap. 8.3):

```typescript
export interface GeocodingProvider {
  readonly name: string;
  forward(address: AddressInput): Promise<GeocodingResult>;
  reverse(lat: number, lng: number): Promise<GeocodingResult>;
  // Provider-Limits
  readonly maxRequestsPerSecond: number;
}
```

**Eingebaute Provider:**

| Provider | Kosten | Quality | Use-Case |
|---|---|---|---|
| `nominatim` | kostenlos (OSM) | mittel | Default, Self-Hosted-fähig (eigener Nominatim-Container) |
| `mapbox` | Free-Tier 100k/Monat | hoch | Empfohlen für Production, beste Adress-Normalisierung |
| `google` | $5/1000 Requests | sehr hoch | Wenn Google-Maps-Integration im Frontend |
| `local` | — | dummy | Tests (fixe Stub-Response) |

**ENV:**
```bash
GEO_PROVIDER=mapbox
GEO_MAPBOX_TOKEN=<env>
# oder
GEO_PROVIDER=nominatim
GEO_NOMINATIM_URL=http://nominatim:8080  # Self-Hosted
GEO_NOMINATIM_EMAIL=ops@example.com      # OSM verlangt Contact
```

### 15.6 Caching von Geocoding-Ergebnissen

Geocoding ist **teuer** (Mapbox/Google) und langsam (Nominatim). Cache aggressiv:

```prisma
model GeocodingCache {
  id           String   @id @default(uuid()) @db.Uuid
  // sha256(provider + normalized_address) als Cache-Key
  cacheKey     String   @unique
  provider     String
  inputAddress Json
  result       Json     // GeocodingResult
  hitCount     Int      @default(0)
  createdAt    DateTime @default(now())
  // TTL — geocoding-Daten ändern sich selten, 90 Tage default
  expiresAt    DateTime
  @@index([expiresAt])
}
```

Cleanup-Cron (via pg-boss): einmal pro Tag abgelaufene Einträge löschen.

### 15.7 REST-Endpunkte

| Method | Path | Beschreibung |
|---|---|---|
| `POST` | `/geo/geocode` | Adresse → Lat/Lng |
| `POST` | `/geo/reverse-geocode` | Lat/Lng → Adresse |
| `GET` | `/addresses` | Liste eigener Adressen (mit Permissions) |
| `POST` | `/addresses` | Adresse anlegen (auto-Geocode) |
| `GET` | `/addresses/:id` | Detail (GeoJSON-Output) |
| `GET` | `/places/nearby?lat=...&lng=...&radius=...` | Räumliche Suche generisch |
| `POST` | `/geofences` | Geofence anlegen (Polygon-GeoJSON in Body) |
| `POST` | `/geofences/:id/contains` | Punkt-in-Polygon-Check |

### 15.8 GeoJSON als Output-Standard

API liefert immer **GeoJSON** für Geo-Felder, weil Mapbox/Leaflet/Apple-Maps das direkt verstehen:

```json
{
  "id": "...",
  "name": "Hauptbahnhof Berlin",
  "location": {
    "type": "Point",
    "coordinates": [13.404954, 52.520008]
  },
  "distanceMeters": 234
}
```

Konvertierung im Repository via `ST_AsGeoJSON(location)::jsonb`. Output-Pipeline (Kap. 7) ergänzt das transparent — keine Service-Logik braucht GeoJSON-Wissen.

### 15.9 Beispiel: Nearby-Query

```typescript
// In einem Repository
async findNearbyPlaces(lat: number, lng: number, radiusM: number, tenantId: string) {
  return this.prisma.$queryRaw<PlaceWithDistance[]>`
    SELECT
      id,
      name,
      ST_AsGeoJSON(location)::jsonb AS location,
      ST_Distance(
        location::geography,
        ST_MakePoint(${lng}, ${lat})::geography
      ) AS "distanceMeters"
    FROM places
    WHERE tenant_id = ${tenantId}
      AND deleted_at IS NULL
      AND ST_DWithin(
        location::geography,
        ST_MakePoint(${lng}, ${lat})::geography,
        ${radiusM}
      )
    ORDER BY "distanceMeters" ASC
    LIMIT 100
  `;
}
```

`ST_DWithin` nutzt den GIST-Index → bei Millionen Records < 50ms.

### 15.10 Sicherheit & Compliance

- **PII**: Adressen sind besonders schützenswert. Felder wie `street`, `zip` werden via Field-Encryption (Kap. 14) verschlüsselt, wenn `features.fieldEncryption` aktiv. **Alternative:** Die strukturierten Felder gar nicht speichern, nur den Geo-Punkt + `formattedAddress` (lower granularity).
- **Permission-System** (Kap. 6) gilt für `Address` und `Geofence` wie für jede andere Resource.
- **Rate-Limiting** für Geocoding-Endpoints — externe API-Costs!
- **Audit-Log** für Geocoding-Calls (Provider-Costs nachvollziehbar)
- **DSGVO Right-to-Erasure** (Kap. 25.8): bei Account-Löschung werden Adressen + GeocodingCache-Einträge anonymisiert
- **IP-Geo-Logging** in Production konservativ — User-Tracking nicht via Server-Side-IP-Geo, sondern explizit durch User-Action

### 15.11 Field-Encryption + Geo

`location` (PostGIS-Point) ist **nicht verschlüsselbar** — sonst funktionieren Spatial-Queries nicht. Trade-off:
- Strukturierte Adress-Felder (`street`, `zip`) → encrypted (PII-Schutz)
- `location` (Point) → unverschlüsselt, da Spatial-Index nötig
- `formattedAddress` → optional encrypted
- Bei strikter PII-Compliance: nur grobe Geo-Daten speichern (z.B. Stadtteil-Polygon statt Hausnummer-Punkt)

Diese Trade-offs müssen pro Use-Case entschieden werden — Doku-Hinweis im Modul.

### 15.12 Frontend-Integration

- **Mapbox** als empfohlener Map-Provider (free Tier großzügig, gute APIs)
- Self-Hosted-Alternative: **MapLibre** + eigener Tile-Server (TileServer GL) wenn Compliance-Anforderungen
- Backend-API liefert immer GeoJSON → direkt `mapbox-gl` / `leaflet`-kompatibel
- TypeScript-Types über OpenAPI generiert (Kap. 28.7) — `Point`, `Polygon`, `FeatureCollection`

### 15.13 PowerSync-Hinweis

Wenn PowerSync (Kap. 13) aktiv: Sync-Rules können Geo-Tabellen synchen, aber **`geometry`-Spalten werden als JSON serialisiert**. Der Mobile-Client speichert sie als JSON-String in SQLite. Spatial-Queries auf dem Mobile-Device sind so **nicht möglich** (SQLite hat keine PostGIS-Erweiterung in PowerSync's Default-Setup).

Workaround für Mobile-Spatial-Queries: simple Bounding-Box-Filterung clientseitig, oder spezielle SQLite-Extensions (`spatialite`) — out of scope für unseren Plan.

### 15.14 Limits

- PostGIS-Performance ist sehr gut bis ~10M Geo-Objects mit GIST-Index
- Komplexe Polygon-Queries (z.B. Polygon-vs-Polygon-Intersection auf Millionen Records) → eventuell Materialized Views
- Geocoding-Rate-Limits beachten (Mapbox: 600 req/min, Google: 50 req/sec, Nominatim: 1 req/sec selbst-hosted oder Public-Limits)

---

## 16. MCP-Server-Modul (Model Context Protocol)

> **Aktivierung:** opt-in via `features.mcp.enabled = true` (default off). Auth läuft über Better-Auth-OAuth-Provider (siehe 13.3). Registriert `/mcp/sse`- und `/mcp/messages`-Endpunkte sowie Auto-Discovery für `@McpTool`-/`@McpResource`-Decorators.

Exposes Backend-Functionalität als **MCP-Server** für AI-Assistenten (Claude Desktop, IDE-Plugins, Agent-Frameworks). Standardisiert nach [Model Context Protocol](https://modelcontextprotocol.io).

### 13.1 Was MCP bereitstellt
| Concept | Bedeutung | Beispiel |
|---|---|---|
| **Tools** | Aufrufbare Funktionen mit Input/Output-Schema | `createProject(name, description) → Project` |
| **Resources** | Read-only Daten-Refs mit URI | `mcp://projects/abc-123` |
| **Prompts** | Wiederverwendbare Prompt-Templates | `summarize-project` |

### 13.2 Architektur
```
LLM-Client (Claude Desktop / IDE)
  → MCP-Transport (stdio | HTTP+SSE)
  → MCPServer (NestJS-Modul)
  → AuthGuard (OAuth-Bearer-Token via Better-Auth-OAuth-Provider)
  → PermissionGuard (re-uses unsere Permission-Engine)
  → Tool-/Resource-Handler (delegiert an existierende Services)
```

Library: `@modelcontextprotocol/sdk` (offiziell von Anthropic).

### 13.3 Mounting & Auth
**Transport-Optionen:**
- **HTTP+SSE** (`/mcp`-Endpoint, Multi-User-tauglich, Auth via Header) — Default für Server-Deployment
- **stdio** — nur für Local-Dev / Single-User

**Auth:**
- Pflicht: OAuth 2.1 Bearer-Token gemäß MCP-Spec (Authorization-Header). Provisioniert über Better-Auth-OAuth-Provider-Plugin (Authorization-Code-Flow + PKCE, Refresh-Tokens, dynamische Client-Registrierung optional).
- Token bindet an einen User → Permissions werden über die Standard-Permission-Engine resolved → MCP-Tools/Resources dynamisch gefiltert (User sieht nur, was er darf).
- Local-Dev (`stdio`-Transport): Auth deaktiviert, läuft als provisionierter Bootstrap-User.

### 13.4 Tool-Registrierung (Decorator-Pattern)
```typescript
@McpTool({
  name: 'createProject',
  description: 'Creates a new project in the current tenant',
  inputSchema: CreateProjectSchema,        // Zod
  permission: { resource: 'projects', action: 'CREATE' },
})
async createProject(input: CreateProjectInput, ctx: McpContext) {
  return this.projectService.create(input, ctx.user);
}

@McpResource({
  uriPattern: 'mcp://projects/{id}',
  description: 'Project details',
  permission: { resource: 'projects', action: 'READ' },
})
async getProject(uri: string, ctx: McpContext) { ... }
```
Auto-Discovery via Reflection — alle dekorierten Methoden werden beim Boot beim MCP-Server registriert.

### 13.5 Permission-Mapping
Standard-Permission-Engine wird wiederverwendet:
- OAuth-Token → User → Roles/Policies (analog REST-Auth)
- `MCPGuard` ruft `PermissionService.authorize()` pro Tool-Call
- Item-Filter aus Permissions wirkt auch hier (User sieht nur eigene Resources)

### 13.6 Endpunkte
| Method | Path | Beschreibung |
|---|---|---|
| `GET` | `/mcp/sse` | MCP Server-Sent-Events Stream |
| `POST` | `/mcp/messages` | MCP Message-Channel |
| `GET` | `/mcp/manifest` | Server-Capabilities (Tools, Resources, Prompts) |

### 13.7 Security
- **Strikte Input-Validation** via Zod auf jedem Tool — LLMs halluzinieren Inputs
- **Audit-Log** für alle MCP-Tool-Calls (separater Event-Type `mcp.tool.invoked`)
- **Rate-Limiting** strenger als REST-Default (LLMs können Burst-Aufrufe machen)
- **Output-Truncation** (max 100KB pro Tool-Response, sonst Pagination)
- OAuth-Clients pro AI-Assistant separat provisionierbar (eigene `client_id`, Scope-Subset, individuelle Token-TTL)

---

## 17. Audit & Logging

### 9.1 Audit-Felder
Alle tenant-scopierten Tabellen haben:
- `createdAt: DateTime` (default: now)
- `updatedAt: DateTime` (auto-update)
- `createdBy: UUID?` (User-ID aus RequestContext)
- `updatedBy: UUID?` (User-ID aus RequestContext)
- `tenantId: UUID?` (aus RequestContext)

### 9.2 Audit-Log-Tabelle (separates Audit-Trail)
```prisma
model AuditLog {
  id          String   @id @default(uuid()) @db.Uuid
  userId      String?  @db.Uuid
  tenantId    String?  @db.Uuid
  resource    String                    // "projects"
  resourceId  String?  @db.Uuid
  action      String                    // "CREATE" | "UPDATE" | "DELETE" | custom
  changes     Json?                     // Diff (before/after)
  ip          String?
  userAgent   String?
  createdAt   DateTime @default(now())
  @@index([resource, resourceId])
  @@index([userId])
  @@index([tenantId])
}
```

### 9.3 Implementierung
- **Prisma Extension** (`$extends`) hooked in `create / update / delete`-Operationen
- Auto-Set `createdBy / updatedBy / tenantId` aus `RequestContext`
- Auto-Insert in `AuditLog` für definierte Resources (per Modul opt-in)
- System-Operationen (Migrations, Seeds) bypassen via `RequestContext.runWithSystem()`

### 9.4 Logging
- **Pino** als Logger (JSON-Output für Production, pretty für Dev)
- Request-ID-Tracing via `X-Request-Id`-Header (auto-generiert wenn fehlend)
- Strukturierte Felder: `userId`, `tenantId`, `requestId`, `route`, `duration`
- HTTP-Exception-Filter loggt 5xx-Fehler mit Stacktrace, 4xx ohne

---

## 18. Request-Context (AsyncLocalStorage)

```typescript
export interface RequestContext {
  requestId: string;
  user?: { id: string; email: string; roles: string[] };
  tenantId?: string;
  tenantIds?: string[];
  isSystemAdmin: boolean;
  language: string;
  ip?: string;
  userAgent?: string;
  // Bypass-Flags (System-Operationen)
  bypassPermissions: boolean;
  bypassTenant: boolean;
}
```

Globale Middleware füllt den Context, alle Service-Layer können via `RequestContextService.get()` zugreifen. Prisma-Extension liest daraus für Audit-Felder und RLS-Session-Variable.

---

## 19. Konfiguration

### 11.1 ENV-Schema (Zod-validiert)
```typescript
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['local', 'ci', 'e2e', 'develop', 'test', 'production']),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().url(),

  BASE_URL: z.string().url(),
  APP_URL: z.string().url().optional(),     // auto-derived from BASE_URL

  BETTER_AUTH_SECRET: z.string().min(32),
  // ...
});
```

### 11.2 Fail-Fast
Beim Boot werden ALLE ENV-Vars validiert. Fehlende oder ungültige Werte → Process-Exit mit Liste aller Probleme.

### 11.3 Pro-Environment-Defaults
- `local` / `ci` / `e2e` → hardgecodete Dummy-Werte (kein `.env` notwendig)
- `develop` / `test` / `production` → harte Pflicht für `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BASE_URL`

---

## 20. Feature-Aktivierung & Template-Charakter

Dieser Server ist **Template** für viele Projekte. Jedes Modul ist über zentrale Config aktivierbar/deaktivierbar; deaktivierte Module haben Footprint Null.

### 19.1 Aktivierungs-Mechanismus

Zentrale Datei `src/config/features.ts` ist **Single Source of Truth**:

```typescript
// src/config/features.ts
import { z } from 'zod';

export const FeaturesSchema = z.object({
  // === Core (Pflicht, nicht abschaltbar) ===
  // auth, permissions, audit, errorCodes, health, requestContext, outputPipeline

  // === Selektive Auth-Methoden ===
  authMethods: z.object({
    emailPassword:  z.boolean().default(true),
    socialProviders: z.array(z.enum(['google', 'github', 'apple', 'discord'])).default([]),
    twoFactor:      z.boolean().default(true),
    passkey:        z.boolean().default(true),
    apiKeys:        z.boolean().default(true),
  }).default({}),

  // === Multi-Tenancy ===
  multiTenancy: z.object({
    enabled:    z.boolean().default(true),
    rls:        z.boolean().default(true),       // Postgres Row-Level Security
    headerName: z.string().default('x-tenant-id'),
  }).default({}),

  // === File-Handling ===
  files: z.object({
    enabled:        z.boolean().default(true),
    storageDefault: z.enum(['s3', 'local', 'postgres']).default('s3'),
    tus:            z.boolean().default(true),
    transformations: z.boolean().default(true),
  }).default({}),

  // === Email ===
  email: z.object({
    enabled:  z.boolean().default(true),
    provider: z.enum(['smtp', 'brevo']).default('smtp'),   // smtp = nodemailer
  }).default({}),

  // === Optional Module (default OFF) ===
  webhooks:  z.object({ enabled: z.boolean().default(false) }).default({}),
  search:    z.object({ enabled: z.boolean().default(false) }).default({}),
  realtime:  z.object({ enabled: z.boolean().default(false) }).default({}),
  powerSync: z.object({ enabled: z.boolean().default(false) }).default({}),
  mcp:       z.object({ enabled: z.boolean().default(false) }).default({}),
  fieldEncryption: z.object({ enabled: z.boolean().default(false) }).default({}),
  geo: z.object({
    enabled: z.boolean().default(false),
    provider: z.enum(['mapbox', 'google', 'nominatim', 'local']).default('nominatim'),
  }).default({}),

  // === Reliability (default ON für Production) ===
  rateLimit:    z.object({ enabled: z.boolean().default(true) }).default({}),
  idempotency:  z.object({ enabled: z.boolean().default(true) }).default({}),
  observability: z.object({ enabled: z.boolean().default(true) }).default({}),
  jobs: z.object({ enabled: z.boolean().default(true) }).default({}),  // pg-boss
});

export type Features = z.infer<typeof FeaturesSchema>;
```

ENV-Override pro Feature über `FEATURE_*` Prefix:
```bash
FEATURE_POWERSYNC_ENABLED=true
FEATURE_WEBHOOKS_ENABLED=true
FEATURE_FILES_STORAGE_DEFAULT=local
FEATURE_AUTH_METHODS_PASSKEY=false
```

### 19.2 Aktivierungs-Matrix

| Modul | Default | Abhängigkeiten | Wann aktivieren? |
|---|---|---|---|
| **Auth (Better-Auth)** | ✅ Pflicht | — | immer |
| **Permissions (CASL)** | ✅ Pflicht | Auth | immer |
| **Output-Pipeline** | ✅ Pflicht | Permissions | immer |
| **Audit-Log** | ✅ Pflicht | RequestContext | immer (Compliance) |
| **Health-Check** | ✅ Pflicht | — | immer |
| **Error-Codes (RFC 7807)** | ✅ Pflicht | — | immer |
| **Helmet/CSP** | ✅ Pflicht | — | immer |
| **Multi-Tenancy** | ✅ Default ON | RLS | bei Single-Tenant-Apps abschalten |
| **Files** | ✅ Default ON | Storage-Adapter | wenn keine Files: abschalten |
| **Email** | ✅ Default ON | — | wenn keine Mails: abschalten |
| **2FA** | ✅ Default ON | Auth | für maximale Security |
| **Passkey** | ✅ Default ON | Auth + URLs | wenn nur Server-Server-API: abschalten |
| **API-Keys** | ✅ Default ON | Auth | für Service-Accounts/Integrationen |
| **Rate-Limiting** | ✅ Default ON | — | nie abschalten in Prod |
| **Idempotency** | ✅ Default ON | — | nie abschalten in Prod |
| **Job-Queue (pg-boss)** | ✅ Default ON | Postgres | wenn keine Background-Jobs: theoretisch abschaltbar |
| **OpenTelemetry** | ✅ Default ON | — | in Tests/Dev abschaltbar |
| **TUS Resumable** | ✅ wenn Files | Files | bei großen Uploads |
| **Image-Transformations** | ✅ wenn Files | Files + sharp | wenn keine Bilder: abschalten |
| **Webhooks** | ⭕ Default OFF | Job-Queue, Outbox | bei B2B / externe Integrationen |
| **Search (FTS)** | ⭕ Default OFF | — | bei Volltextsuche-Use-Cases |
| **Realtime (Socket.IO)** | ⭕ Default OFF | LISTEN/NOTIFY | bei Web-Live-Updates |
| **PowerSync** | ⭕ Default OFF | Postgres logical repl. | nur wenn Mobile-App geplant |
| **MCP-Server** | ⭕ Default OFF | OAuth-Provider (Better-Auth) | nur wenn AI-Integration |
| **Field-Encryption** | ⭕ Default OFF | KEK-Management | nur bei PII-Compliance-Anforderungen |
| **Geo / Standortdaten** | ⭕ Default OFF | PostGIS-Extension, Geocoding-Provider | bei Adressen-Verwaltung, Karten-Integration, räumlichen Queries |
| **Social-Login** | ⭕ Default OFF | OAuth-Credentials | pro Provider explizit aktivieren |

Legende: ✅ default ON / ⭕ default OFF / **Pflicht** = nicht abschaltbar.

### 19.3 Boot-Verhalten

```typescript
// src/app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ schema: EnvSchema }),
    FeaturesModule.forRoot(),

    // Pflicht-Module
    AuthModule,
    PermissionsModule,
    OutputPipelineModule,
    AuditModule,
    HealthModule,

    // Conditional Module
    ...conditionalImport('multiTenancy', MultiTenancyModule),
    ...conditionalImport('files',       FilesModule),
    ...conditionalImport('email',       EmailModule),
    ...conditionalImport('webhooks',    WebhooksModule),
    ...conditionalImport('search',      SearchModule),
    ...conditionalImport('realtime',    RealtimeModule),
    ...conditionalImport('powerSync',   PowerSyncModule),
    ...conditionalImport('mcp',         McpModule),
    ...conditionalImport('fieldEncryption', EncryptionModule),
    ...conditionalImport('geo',             GeoModule),
  ],
})
export class AppModule {}
```

`conditionalImport()` ist ein Helper, der nur Module zurückgibt wenn das Feature aktiviert ist:
```typescript
function conditionalImport<T>(feature: keyof Features, mod: T): T[] {
  return features[feature]?.enabled ? [mod] : [];
}
```

**Konsequenz:**
- Deaktiviertes Modul → keine Provider, keine Routes, keine Listener, keine Migrations-Ausführung
- Lazy-Imports für schwere Dependencies (sharp, @powersync/service, @modelcontextprotocol/sdk) — werden nur geladen wenn Feature an

### 19.4 Migrations-Strategie für deaktivierte Features

Deaktivierte Features dürfen keine ihrer Tabellen anlegen, sonst läuft der DB-Schema voll. Strategie:

**Approach A: Feature-Marker in Migrations**
```typescript
// prisma/migrations/20260501_webhooks/migration.sql
-- @feature: webhooks
-- @up
CREATE TABLE webhook_endpoints (...);
-- @down
DROP TABLE webhook_endpoints;
```
Custom-Migration-Runner wendet Migration nur an, wenn Feature aktiviert.

**Approach B: Per-Feature Schema-Files**
- `prisma/schema.prisma` (Core)
- `prisma/features/webhooks.prisma` (nur include wenn aktiviert)
- Build-Step kombiniert Schemas vor `prisma generate`

**Empfehlung:** Approach B (sauberer, weniger Magic). Build-Skript:
```bash
bun run prepare:schema   # liest features.ts → konkateniert die nötigen schema-Files
bunx prisma generate
bunx prisma migrate dev
```

### 19.5 Setup-Wizard (`bun run setup`)

Interaktives Skript für neue Projekte:
```
$ bun run setup
✔ Projekt-Name? my-app
✔ Multi-Tenant? (Y/n) Y
✔ Mobile-App geplant? (y/N) Y → aktiviert PowerSync
✔ Webhooks für externe Integrationen? (y/N) N
✔ Suche notwendig? (y/N) Y → aktiviert Search-Modul
✔ AI/MCP-Integration? (y/N) N
✔ PII-Verschlüsselung? (y/N) N
✔ Realtime-Updates im Frontend? (Y/n) Y → aktiviert Socket.IO
✔ Email-Provider? Brevo
→ Features schreiben in src/config/features.ts
→ Schema-Konkatenation
→ Initial Prisma-Migration
→ ENV-Template erzeugen (.env.example)
```

Reduziert Onboarding für neue Projekte auf einen Befehl. Generiert konsistente Config — niemand muss sich durch alle Kapitel arbeiten.

### 19.6 Feature-Abhängigkeiten validieren

`FeaturesModule.forRoot()` validiert beim Boot:
```typescript
const RULES = [
  { needs: 'powerSync', requires: 'jobs',         reason: 'Sync-State braucht Job-Queue' },
  { needs: 'webhooks',  requires: 'jobs',         reason: 'Webhook-Dispatcher läuft auf pg-boss' },
  { needs: 'webhooks',  requires: 'outbox',       reason: 'Reliable Event-Dispatch' },
  { needs: 'realtime',  requires: 'jobs',         reason: 'NOTIFY-Trigger via Outbox' },
  { needs: 'mcp',       requires: 'authMethods.oauth',   reason: 'MCP-Auth via Better-Auth-OAuth-Provider' },
  { needs: 'powerSync', requires: 'multiTenancy', reason: 'Tenant-basierte Sync-Buckets' },
];
// Bei Konflikt: Process-Exit mit klarer Fehlermeldung
```

### 19.7 Deaktivierungs-Garantien

Wenn ein Feature deaktiviert ist:
- ✅ Module wird nicht in DI-Container geladen
- ✅ Routes werden nicht registriert (404 statt 403)
- ✅ Tabellen werden nicht angelegt (Migration übersprungen)
- ✅ Schwere Libraries werden nicht ge-importet (Bundle-Size, Boot-Zeit)
- ✅ Feature taucht nicht in OpenAPI-Doku auf
- ✅ Feature taucht nicht im Permission-System als Resource auf
- ✅ ENV-Validation erlaubt fehlende ENV-Vars für deaktivierte Features

### 19.8 Pro-Projekt-Customization

`src/modules/` ist der projekt-spezifische Code:
- Eigene Resources (Project, Task, Order, …)
- Eigene Filter-Services für diese Resources
- Eigene Permissions-Bootstraps (Seed-Skripte für Default-Rollen)
- Eigene Email-Templates
- Eigene OpenAPI-Tags

`src/core/` bleibt **identisch** zwischen Projekten — Updates an der Core-Lib können per Sync-Skript übernommen werden, ohne Projekt-Code zu touchieren.

### 19.9 Update-Pfad für Template-Improvements

Template-Updates (neue Standards, Security-Fixes, neue Features) werden über Git-Tags versioniert:
```
v1.0.0 — initial
v1.1.0 — Webhooks-Modul + RFC 9745 Deprecation-Header
v2.0.0 — Breaking: Permission-System auf v2 (CASL 7)
```

Pro Projekt gibt es ein **CHANGELOG-template.md**, das bei jedem Pull der Template-Updates abgehakt wird. Templates dürfen kein Magic über `src/modules/` machen — Projekte sind Owner ihrer eigenen Domain-Module.

---

## 21. Validation & DTOs (Zod)

### 12.1 Pattern
```typescript
// Schema = Single Source of Truth
export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.enum(['draft', 'published']).default('draft'),
});

// Auto-generated DTO-Klasse für Swagger
export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}
```

### 12.2 OpenAPI-Generierung
- `nestjs-zod` (oder Eigenbau-Bridge) generiert Swagger-Schema aus Zod
- DTO-Klasse ist Type-safe, OpenAPI-Doku ist automatisch up-to-date

### 12.3 Pipe
- Globale `ZodValidationPipe`, wirft `BadRequestException` mit strukturierten Field-Errors

---

## 22. Filtering, Sortierung, Pagination, Field-Selection

API-Query-Notation folgt **PostgREST-Standard** — kompakt, URL-freundlich, vom Postgres-Ökosystem her geläufig. Intern wird in Filter-Rules (Directus-DSL, Kap. 6.3) konvertiert; beide Formate sind interoperabel.

### 18.1 Filter-Operatoren (PostgREST-kompatibel)
```
GET /projects?status=eq.published
            &createdAt=gte.2026-01-01
            &name=ilike.*alice*
            &tags=cs.{vip,featured}
            &or=(status.eq.draft,owner_id.eq.$current_user)
```

| Operator | Bedeutung |
|---|---|
| `eq` | gleich |
| `neq` | ungleich |
| `gt` / `gte` / `lt` / `lte` | Vergleich |
| `like` / `ilike` | LIKE / ILIKE (mit `*` als Wildcard) |
| `in` | `?id=in.(1,2,3)` |
| `cs` | contains (Array enthält Werte) |
| `cd` | contained-by (Array ist Subset) |
| `ov` | overlap (Arrays haben Schnittmenge) |
| `is` | `is.null` / `is.true` / `is.false` |
| `not.<op>` | Negation, z.B. `status=not.eq.archived` |

### 18.2 Logische Verknüpfung
- Mehrere Query-Params → AND
- `?or=(a.eq.1,b.eq.2)` → OR-Gruppe
- `?and=(...)` → explizite AND-Gruppe (für Verschachtelung)
- Variablen in Werten: `$current_user`, `$current_tenant`, `$now`

### 18.3 Sortierung
```
?order=-createdAt,name
?order=createdAt.desc,name.asc          # explizit
?order=createdAt.desc.nullslast
```
Default-Sort pro Resource konfigurierbar (Searchable-Config).

### 18.4 Field-Selection (Sparse Fieldsets)
```
?select=id,name,status                  # nur diese Felder
?select=id,name,owner(id,email)         # mit Relation-Subset
?select=*,tags                          # alle Basis-Felder + tags
```
Permission-Field-Whitelist greift zusätzlich — User sieht nie mehr Felder als die Permission erlaubt.

### 18.5 Pagination
**Drei Modi:**

**Page-basiert (Standard für UI):**
```
?page=2&limit=25
```
Response-Meta:
```json
{ "meta": { "total": 1234, "page": 2, "pageCount": 50, "limit": 25 } }
```

**Offset-basiert (PostgREST-kompatibel):**
```
?limit=25&offset=50
Range: 50-74
Range-Unit: items
Response: Content-Range: 50-74/1234
```

**Cursor-basiert (Bulk/Sync, Stripe-Style):**
```
?starting_after=<id>&limit=100
?ending_before=<id>&limit=100
```
Response-Meta:
```json
{ "meta": { "hasMore": true, "nextCursor": "...", "limit": 100 } }
```

**Link-Header (RFC 5988, alle Modi):**
```
Link: <...?page=3>; rel="next", <...?page=50>; rel="last"
```

### 18.6 Defaults & Limits
| Parameter | Default | Maximum |
|---|---|---|
| `limit` | 25 | 1000 (über Resource-Config / Permission konfigurierbar) |
| `page` | 1 | unbegrenzt |
| `select` | alle erlaubten Felder | — |
| `order` | Resource-Default (meist `-createdAt`) | max 5 Sort-Felder |

### 18.7 Konvertierungs-Pipeline
```
PostgREST-Query (URL)
  → @ApiQueryParser-Pipe (Zod-validiert)
  → Filter-Rule (Directus-DSL, intern)
  → merge mit Permission.itemFilter (AND)
  → Prisma.WhereInput
  → DB-Query
```
Vorteil: API-Konsumenten arbeiten mit kompaktem Standard, intern bleibt eine Filter-Sprache (Directus-DSL für Permissions + Storage), Konversion ist verlustfrei.

### 18.8 Sicherheit
- Whitelist erlaubter Felder pro Resource (Filter, Sort, Select) — Stalking-Schutz für Felder die nicht read-permitted sind
- Whitelist erlaubter Operatoren pro Feld (z.B. nur `eq` auf `email`, nicht `ilike`)
- Operator-Limit: max 50 Filter-Conditions pro Request, max Tiefe 3 (or/and-Verschachtelung)
- Encrypted Felder (Kap. 12) sind **nicht** filterbar (außer via Blind-Index)

---

## 23. Cron Jobs

### 14.1 Konfiguration in Code
```typescript
@Injectable()
export class ProjectCronJobs {
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpired() { /* ... */ }
}
```

### 14.2 DB-konfigurierbare Jobs (optional)
```prisma
model ScheduledJob {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @unique
  cron      String
  enabled   Boolean  @default(true)
  // Implementation-Key, mapped auf registrierte Handler im Code
  handler   String
  args      Json?
  lastRunAt DateTime?
  lastError String?
}
```

Pro Tenant aktivierbar/deaktivierbar – nützlich für SaaS-Use-Cases.

---

## 24. Health-Check

Endpunkte:
- `GET /health` – einfacher Liveness
- `GET /health/ready` – Readiness (DB, Storage, Email-Provider)

Checks (`@nestjs/terminus`):
- Postgres `SELECT 1`
- Storage-Adapter `head()` auf Test-Key
- Memory Heap & RSS
- Disk-Storage (für lokale Adapter)

---

## 25. System-Setup

Erste Boot-Phase, wenn `User`-Tabelle leer ist:
- `GET /system/setup/status` – `{ needsSetup: true }`
- `POST /system/setup/init` – Body `{ email, password, name }` → erstellt ersten Admin-User mit `Administrator`-Rolle
- ENV-getrieben: `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` → Auto-Creation beim Boot
- Endpunkt sperrt sich permanent, sobald min. 1 User existiert

---

## 26. Error-Codes

### 17.1 Format
```
#PREFIX_XXXX: Technical Description
```

### 17.2 Registry
```typescript
export const Errors = {
  UNAUTHORIZED: {
    code: 'CORE_0100',
    message: 'Unauthorized',
    translations: { en: 'Unauthorized', de: 'Nicht authentifiziert' },
  },
  // ...
} as const;
```

### 17.3 Endpoint
- `GET /errors/:locale` – komplette Translation-Map für Frontend-i18n
- Custom-Errors mergeable über `additionalErrorRegistry`-Config

---

## 27. API-Konventionen

### 18.1 Versionierung
- Pfad-basiert: `/v1/...`
- v1 = Default-Mount

### 18.2 Response-Envelope
```json
{
  "data": <payload>,
  "meta": { "total": 100, "page": 1, "pageCount": 5, "limit": 25 }
}
```
oder bei Errors:
```json
{
  "error": {
    "code": "CORE_0100",
    "message": "Unauthorized",
    "details": [...]
  }
}
```

### 18.3 Status-Codes
- `200` Read/Update success
- `201` Create success
- `204` Delete success (no body)
- `400` Validation
- `401` Unauthenticated
- `403` Permission denied
- `404` Not found
- `409` Conflict (unique violation, optimistic-lock)
- `422` Semantic validation
- `429` Rate-limited
- `500` Server error

### 18.4 OpenAPI
- Spec unter `GET /openapi.json` — auto-generiert aus Zod-Schemas
- Voll-typisiert via Zod-Bridge
- API-UI siehe Kap. 27 (Scalar als modernes Frontend für die OpenAPI-Spec)

---

## 28. Developer Experience (DX)

Eine gute Entwickler-Erfahrung ist **kein Luxus**, sondern reduziert Onboarding-Zeit, Bug-Rate und Produktivitätsverluste. Dieses Kapitel sammelt alle DX-Tools, die im Template enthalten sind.

### 27.1 Übersicht der Dev-Tools

| Tool | Zweck | URL (Dev) | Aktivierung |
|---|---|---|---|
| **Scalar** | Modernes API-UI (OpenAPI-Frontend) | `/reference` | default ON in Dev, in Prod hinter Admin-Permission |
| **NestJS DevTools** | Module-Graph, Routes, Dependencies | `localhost:8000` (Cloud) | default ON in Dev |
| **Dev-Hub** | Zentrale Landing-Page mit Links | `/dev` | default ON in Dev |
| **Prisma Studio** | DB-Browser + Editor | `localhost:5555` (extern) | `bun run db:studio` |
| **pgAdmin** | Postgres-Admin (Power-User) | `localhost:5050` (Compose `tools` profile) | docker-compose-Profil |
| **Mailpit** | Email-Testing (SMTP-Trap + UI) | `localhost:8025` | docker-compose default |
| **Permission-Tester** | "Was darf User X auf Resource Y?" | `/admin/permissions/test` | Permissions-Modul |
| **Webhook-Inspector** | Delivery-Log + Re-Deliver | `/admin/webhooks` | Webhooks-Modul (wenn aktiv) |
| **Realtime-Inspector** | Active Sockets, Subscriptions, Live-Stream | `/admin/realtime` | Realtime-Modul (wenn aktiv) |
| **Audit-Browser** | Audit-Log mit Filter + Diff-Anzeige | `/admin/audit` | Audit-Modul |
| **Search-Tester** | Probier-UI für FTS-Queries | `/admin/search` | Search-Modul (wenn aktiv) |

Alle `/admin/*`-Routes sind permissioniert via `admin:dx`-Scope und in Production nur für SystemAdmin sichtbar.

### 27.2 Scalar — modernes API-UI (statt Swagger UI)

[Scalar](https://scalar.com) ist die aktuelle Top-Wahl für moderne API-Dokumentation. Drop-in-Replacement für Swagger UI, deutlich besseres UX.

**Warum Scalar:**
- Schnelle, durchsuchbare UI mit Sidebar
- Try-It-Out direkt eingebaut, mit Auto-Auth aus Cookie/Token
- Dark Mode + 12 vorgefertigte Themes
- Generiert Code-Snippets in 20+ Sprachen (curl, fetch, axios, Python, Go, …)
- Volle OpenAPI 3.1-Unterstützung inkl. RFC 7807-Schemas
- Open Source (Apache 2.0)
- Integration via `@scalar/nestjs-api-reference`

**Setup:**
```typescript
// src/main.ts
import { apiReference } from '@scalar/nestjs-api-reference';

const document = SwaggerModule.createDocument(app, config);
app.use('/openapi.json', (_req, res) => res.json(document));

app.use('/reference', apiReference({
  spec: { url: '/openapi.json' },
  theme: 'purple',                    // oder default, alternate, moon, solarized, ...
  metaData: { title: 'My API' },
  authentication: {
    preferredSecurityScheme: 'bearerAuth',
  },
}));
```

**Production-Hardening:**
```typescript
if (env.NODE_ENV === 'production') {
  app.use('/reference', AuthGuard, RequireScope('admin:dx'), apiReference({...}));
}
```

### 27.3 NestJS DevTools

Offizielles Tool von der NestJS-Crew: [`@nestjs/devtools-integration`](https://docs.nestjs.com/devtools/overview). Visualisiert die komplette Application-Struktur — Module, Controller, Provider, Routes, Dependencies — als interaktiver Graph.

**Was es kann:**
- **Module-Graph** — sieh die Architektur als Dependency-Tree, debug fehlende Provider sofort
- **Routes-Browser** — alle Routes mit Guards, Pipes, Interceptors
- **Class-Graph** — DI-Auflösung pro Klasse
- **Application-Snapshot** für GitHub-Issues / Code-Reviews
- Time-Travel: vergleiche zwei Snapshots (z.B. vor/nach Refactor)

**Setup:**
```typescript
// src/main.ts
const app = await NestFactory.create(AppModule, {
  snapshot: env.NODE_ENV === 'develop',
});
```

```typescript
// src/app.module.ts
@Module({
  imports: [
    DevtoolsModule.register({
      http: env.NODE_ENV === 'develop',
      port: 8000,
    }),
    // ...
  ],
})
```

UI: https://devtools.nestjs.com (Cloud-UI, free für OSS, kostenpflichtig kommerziell). Cloud-UI verbindet sich zu `localhost:8000`.

**Aktivierung:** Default ON in `develop`-Env, OFF in Prod (Snapshot-Generierung kostet Boot-Zeit).

### 27.4 Dev-Hub — zentrale Landing-Page

Statt dass jeder Entwickler die URLs der einzelnen Tools auswendig kennen muss, gibt's eine **Landing-Page** unter `/dev`, die alles bündelt.

```
┌─ Developer Hub — my-app ────────────────────────────────┐
│                                                         │
│  📚 API & Schema                                        │
│   • Scalar API Reference     /reference                 │
│   • OpenAPI Spec (raw)       /openapi.json              │
│   • Permissions Tester       /admin/permissions/test    │
│                                                         │
│  🏗  Architecture                                       │
│   • NestJS DevTools          localhost:8000             │
│   • Active Features          /dev/features              │
│                                                         │
│  💾 Data                                                │
│   • Prisma Studio            run: bun db:studio         │
│   • pgAdmin                  localhost:5050             │
│   • Audit-Browser            /admin/audit               │
│                                                         │
│  📨 Async                                               │
│   • Webhook-Inspector        /admin/webhooks            │
│   • Realtime-Inspector       /admin/realtime            │
│                                                         │
│  📧 Communication                                       │
│   • Mailpit                  localhost:8025             │
│                                                         │
│  ⚙️  Health                                             │
│   • /health                  /health                    │
│   • /health/ready            /health/ready              │
│   • OTel-Collector           localhost:4318             │
│                                                         │
│  📦 Active Modules: auth, permissions, files, ...      │
│  📋 Bun: 1.2.4 · Node: 22.x · Postgres: 17 · …        │
└─────────────────────────────────────────────────────────┘
```

Implementation: einfache HTML-Seite, die Feature-Flags und Tool-URLs aus `features.ts` liest. Auto-aktualisiert wenn ein Feature an-/ausgeschaltet wird (zeigt nur Tools für aktive Features).

**Aktivierung:** Default ON in `develop`/`local`, OFF in `production`.

### 27.5 Job-Dashboard (pg-boss) — *Post-v1, optional*

> **Status:** Aus v1 ausgenommen (Entscheidung 33.11). Bis dahin: SQL-Snippets / CLI-Tooling. Folgender Entwurf ist Referenz für eine spätere Iteration, falls Operations eine UI einfordert.

pg-boss bringt keine offizielle UI mit. Geplante minimale Dashboard-Skizze:

```
┌─ Jobs & Queues ──────────────────────────────────────────┐
│                                                          │
│  Active:    12  ████████░░░░░░░  Queue: 47 waiting      │
│  Completed: 234,567 (24h)                                │
│  Failed:    23 (24h)  ⚠ 3 needing attention              │
│                                                          │
│  Recent Jobs                                             │
│   ✅ webhook.dispatch    project.created   1.2s   12:34 │
│   ✅ email.send          welcome           0.8s   12:33 │
│   🔄 powersync.sync      tenant_xyz       —      12:33 │
│   ❌ webhook.dispatch    user.deleted      timeout       │
│   …                                                      │
│                                                          │
│  [Retry Failed]  [Clear Completed]  [Trigger Manual]     │
└──────────────────────────────────────────────────────────┘
```

Alternativ: Bull-Board ist nicht direkt mit pg-boss kompatibel — aber es gibt [`pg-boss-dashboard`](https://github.com/Tomatosoup97/pg-boss-dashboard) als community-gepflegtes UI. Wir evaluieren beides; Eigenbau ist unter ~300 LOC machbar wenn die Community-Lösung zu instabil ist.

### 27.6 Permission-Tester

Sehr nützliches Debug-Tool. Frontend für `POST /admin/permissions/test`:

```
┌─ Permission Tester ──────────────────────────────────────┐
│                                                          │
│  Test as User:  [alice@example.com ▼]                    │
│  Active Tenant: [Acme Corp ▼]                            │
│                                                          │
│  Action:    [read ▼]                                     │
│  Subject:   [Project ▼]                                  │
│  Item ID:   [optional UUID]                              │
│                                                          │
│  [▶ Test Permission]                                     │
│                                                          │
│  ─── Result ──────────────────────────                  │
│  ✅ ALLOWED                                              │
│                                                          │
│  Resolved Rules (3):                                     │
│   1. policy "team-member": can read Project              │
│      where tenant_id = $CURRENT_TENANT                   │
│   2. policy "owner": can manage Project                  │
│      where owner_id = $CURRENT_USER                      │
│   3. fields: id, name, description, status, owner_id    │
│                                                          │
│  Effective Prisma WHERE:                                 │
│   { OR: [                                                │
│     { tenantId: 'xyz' },                                 │
│     { ownerId: 'alice-uuid' }                            │
│   ]}                                                     │
└──────────────────────────────────────────────────────────┘
```

Reduziert "warum sehe ich diesen Datensatz nicht"-Tickets dramatisch.

### 27.7 Code-Generation für Frontend

OpenAPI-Spec → typed Frontend-SDK. Default-Tool: [kubb](https://kubb.dev) (plugin-basiert, generiert TanStack-Query-Hooks, Zod-Schemas und MSW-Mocks aus OpenAPI 3.1).

```bash
bun run sdk:generate
# liest /openapi.json → erzeugt Type-Safe Client in ./generated/api-client/ (für externes Konsumieren als publiziertes npm-Paket vorgesehen)
```

Output:
- TypeScript-Types pro Schema
- TanStack-Query-Hooks pro Endpoint
- Zod-Schemas zur Runtime-Validation
- MSW-Mocks für Tests

Single-Repo-Layout: SDK wird via separater `package.json` im `./generated/api-client/`-Subpfad publiziert (eigenständiges npm-Paket). Konsumierende Apps installieren über `npm i @<scope>/api-client`.

### 27.8 Hot-Reload & Bun-Watch

`bun --watch` ist deutlich schneller als `nodemon` oder `ts-node-dev`. Restart-Zeit < 200ms statt 2-3s.

```json
{
  "scripts": {
    "dev": "bun --watch src/main.ts",
    "dev:debug": "bun --watch --inspect src/main.ts"
  }
}
```

### 27.9 IDE-Setup (`.vscode/`)

Im Template enthalten:
- Empfohlene Extensions (Prisma, ESLint, Zod-Helper, Bun, REST-Client)
- Launch-Configs für Debugging (App + Tests)
- Tasks für `bun run dev`, `bun run test`, `bun run db:migrate`
- Settings für oxfmt-on-save

### 27.10 Onboarding-Skript

`bun run onboard` für neue Devs:
- Checkt Bun-Version, Postgres-Connection, Docker-Status
- Führt Setup-Wizard aus (Kap. 19.5)
- Seeded Demo-Daten für lokale Entwicklung
- Öffnet Dev-Hub im Browser
- Druckt Quick-Start-Cheatsheet

### 27.11 Diagnostik-Endpoint (`/dev/diagnostics`)

In Dev/Local zugänglich, in Prod hinter Admin-Permission. Zeigt:
- Aktivierte Features (aus `features.ts`)
- Counts: User, Tenants, Sessions, aktive Webhooks, Jobs in Queue
- Letzter Migration-Status
- DB-Pool-Status
- OTel-Trace-Endpoint reachable
- Storage-Adapter health (S3-`HeadBucket`)
- Email-Provider connectivity test

Hilft bei Bug-Reports — Devs können einen Snapshot anhängen.

---

## 28b. Testing-Strategie & TDD

### 28b.1 Leitlinie
**Test-Driven Development ist verbindlich.** Jedes neue Feature, jeder Bugfix und jede `src/core/`-Änderung folgt dem Red-Green-Refactor-Zyklus:

1. **Red:** Story-/E2E-Test schreiben, der die gewünschte Behaviour beschreibt — Test schlägt fehl.
2. **Green:** Minimal-Implementation, die den Test grün macht.
3. **Refactor:** Implementation aufräumen, Tests bleiben grün.

PRs ohne (oder mit ausschließlich nachträglich erstellten) Tests werden abgelehnt. Inspirations-Quelle ist [`lenneTech/nest-server/tests` (develop-Branch)](https://github.com/lenneTech/nest-server/tree/develop/tests) — dieses Template ist die nächste Version dieses Projekts und übernimmt das Test-Layout.

### 28b.2 Test-Layout
Orientiert an `lenneTech/nest-server/tests`:

```
tests/
├── stories/                     # TDD Story-Tests pro User-Journey (.story.test.ts)
│   ├── auth/
│   ├── permissions/
│   ├── files/
│   ├── webhooks/
│   └── …
├── unit/                        # Pure Function / Helper / Config-Tests (.spec.ts)
├── types/                       # TypeScript-Compile-Tests (.type-test.ts)
├── migrate/                     # Migration-Verification-Tests
├── k6/                          # Load- / Memory-Tests (optional, nur main + Tags)
├── global-setup.ts              # Vitest globalSetup: Postgres-Test-Container, Prisma-Migrate, Seed
├── *.e2e-spec.ts                # Klassische REST-E2E-Tests pro Feature
└── tsconfig.json
```

### 28b.3 Test-Kategorien

| Kategorie | Datei-Suffix / Ort | Tooling | Wofür |
|---|---|---|---|
| **Unit** | `tests/unit/*.spec.ts` | Vitest | Pure Functions, Configs, Helpers, Hash-/Encrypt-Utilities |
| **Story (TDD)** | `tests/stories/**/*.story.test.ts` | Vitest + Supertest | Eine User-Story = ein Test-File. End-to-End durch HTTP-Layer |
| **REST-E2E** | `tests/*.e2e-spec.ts` | Vitest + Supertest | Edge-Cases pro Feature (Permissions, Errors, Cookies, Rate-Limits) |
| **Type-Tests** | `tests/types/*.type-test.ts` | `tsc --noEmit` | Compile-Zeit-Garantien für Public-APIs (Generics, Branding) |
| **Performance** | `tests/k6/` | k6 | Load-/Memory-Tests |
| **Migration** | `tests/migrate/` | Vitest + Postgres | Up- und Down-Migrations |

### 28b.4 Test-Helpers (übernommen / adaptiert)
- **`global-setup.ts`** — startet Postgres-Test-Container (`testcontainers`-Lib), führt `prisma migrate deploy` aus, seeded Bootstrap-Admin.
- **`TestHelper`** — Builder für authentifizierte Test-Requests, Tenant-Bootstrap, User-Provisionierung mit Roles, parallel-sichere Daten via UUID-Suffix in Emails (`alice+<uuid>@test.com`).
- **Cleanup-Strategie** — IDs sammeln und am Ende per `afterAll` zielgerichtet löschen statt `truncate` (parallel-tauglich).
- **`request(app)`** — supertest-Wrapper, OAuth-/Better-Auth-Token automatisch setzen.

### 28b.5 Was wir aus nest-server NICHT übernehmen
| Quelle | Grund |
|---|---|
| `subscription-auth.e2e-spec.ts`, `graphql-cookie-auth.story.test.ts` | GraphQL ist Out of Scope (§1.4) |
| `mongoose-plugins.e2e-spec.ts`, `push-pull-array.e2e-spec.ts`, `subdocument-array-optimization.spec.ts`, `mongo-state-store.e2e-spec.ts` | Mongoose/MongoDB sind gestrichen — wir nutzen Prisma + Postgres |
| `unified-field-*.e2e-spec.ts`, `unified-field-whitelist.spec.ts`, `register-enum.e2e-spec.ts` | `@UnifiedField` ist gestrichen — Zod ist Single Source of Truth |
| `scenario-1-legacy-only.e2e-spec.ts`, `scenario-3-iam-only.e2e-spec.ts`, `scenario-3-http410.e2e-spec.ts`, `three-scenarios.e2e-spec.ts`, `legacy-auth-rate-limit.story.test.ts`, `bidirectional-auth-sync.e2e-spec.ts`, `middleware-credential-fallback.e2e-spec.ts` | Legacy-Auth-Migrationspfade entfallen — nur Better-Auth |
| `core-module-signatures.spec.ts` | nest-server-spezifisch (Library-Signatures) |

### 28b.6 Was wir 1:1 übernehmen / adaptieren
| Quelle | Adaption |
|---|---|
| `safety-net.spec.ts` + `safety-net.e2e-spec.ts` | Output-Pipeline Stage 4 (Secret-Safety-Net) |
| `multi-tenancy.e2e-spec.ts` + `tenant-guard.e2e-spec.ts` | Tenant-Isolation auf RLS-Layer adaptiert |
| `better-auth-api.story.test.ts`, `better-auth-integration.story.test.ts`, `better-auth-plugins.story.test.ts`, `better-auth-jwt-middleware.story.test.ts`, `better-auth-rate-limit.story.test.ts`, `better-auth-email-verification.story.test.ts`, `better-auth-enabled.e2e-spec.ts`, `better-auth-rest-security.e2e-spec.ts`, `better-auth-security.e2e-spec.ts`, `better-auth-config-deep-merge.spec.ts`, `better-auth-cookie-helper.spec.ts`, `better-auth-trusted-origins.spec.ts`, `better-auth-disable-signup.e2e-spec.ts`, `better-auth-autoregister-false.e2e-spec.ts`, `better-auth-migration-status.e2e-spec.ts`, `better-auth-module-registration.e2e-spec.ts`, `auth-parallel-operation.e2e-spec.ts`, `auth-scenarios.e2e-spec.ts`, `user-enumeration-default.e2e-spec.ts`, `user-enumeration-prevention.e2e-spec.ts` | Auth-Flows direkt übertragbar |
| `error-code.story.test.ts`, `error-code-scenarios.e2e-spec.ts` | RFC 7807 Verhalten + `CORE_*`/`APP_*` Prefixe |
| `email-service.e2e-spec.ts` | Email-Versand (Mailpit-Trap in Tests) |
| `file.e2e-spec.ts`, `tus-upload.story.test.ts`, `tus-file-type-validation.spec.ts` | File-Handling, Multipart-Upload, TUS, Mime-Validation |
| `pagination-metadata.story.test.ts` | Pagination-Format |
| `system-setup.e2e-spec.ts` | Initial-Admin-Bootstrap |
| `cookies-cors-config.spec.ts`, `cookies-security-property.e2e-spec.ts` | Cookie- und CORS-Config |
| `permissions-report.e2e-spec.ts` | Permission-Engine + `/admin/permissions/test` |
| `performance-caches.spec.ts` | Cache-Verhalten (LRU, TTL, Invalidation) |
| `remove-secrets.spec.ts` | Secret-Strip-Logik (Pipeline-Stage 4) |
| `map-and-validate.pipe.e2e-spec.ts` | Zod-Validation-Pipe (statt class-validator) |
| `project.e2e-spec.ts`, `server.e2e-spec.ts` | Generische Resource-CRUD- und Server-Boot-Smoketests |
| `k6/memory-test.{js,sh}`, `k6/healthcheck.js` | Load- und Memory-Tests |

### 28b.7 Coverage-Ziele & Quality-Gates
- **`src/core/`:** ≥ 90 % Line-Coverage **Pflicht** (CI-Gate, Build bricht ab)
- **`src/modules/`:** ≥ 80 % Line-Coverage empfohlen, projekt-spezifisch festlegbar
- **Mutation-Testing:** Stryker auf Core-Pipeline-Komponenten (Output-Pipeline, Permission-Engine, Field-Encryption) — quartalsweise, kein CI-Gate
- **Flaky-Tests:** Drei Wiederholungen automatisch, danach Fail. Wiederkehrend flaky → in `tests/quarantine/` verschieben + Issue

### 28b.8 CI-Integration (GitLab CI)
```yaml
test:unit:
  stage: test
  script: [bun install, bun run test:unit]

test:e2e:
  stage: test
  services: [postgres:17]
  script:
    - bun install
    - bun run test:e2e
  coverage: '/Lines\s*:\s*([\d.]+)%/'
  artifacts:
    reports:
      junit: reports/junit.xml
      coverage_report:
        coverage_format: cobertura
        path: reports/coverage.xml

test:types:
  stage: test
  script: [bun install, bun run test:types]

test:performance:
  stage: test
  rules:
    - if: '$CI_COMMIT_BRANCH == "main" || $CI_COMMIT_TAG'
  script: [k6 run tests/k6/memory-test.js]
```

### 28b.9 TDD-Workflow pro Feature
1. **Story formulieren** in `tests/stories/<domain>/<story>.story.test.ts` (Given/When/Then in `describe`/`it`).
2. `bun run test:watch <story>` — Test ist Red.
3. Nur so viel Code in `src/core/` oder `src/modules/` schreiben, bis Test Green wird.
4. Refactor (Tests bleiben Green).
5. Edge-Cases als zusätzliche `.e2e-spec.ts` ergänzen.
6. PR öffnen — Review prüft: Test existierte vor dem Code (Commit-Reihenfolge sichtbar).

### 28b.10 npm-Scripts (verbindlich)
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run tests/unit",
    "test:e2e": "vitest run tests/**/*.e2e-spec.ts tests/stories",
    "test:types": "tsc -p tests/types/tsconfig.json --noEmit",
    "test:coverage": "vitest run --coverage",
    "test:perf": "k6 run tests/k6/memory-test.js"
  }
}
```

---

## 29. Standards & Konventionen

Dieses Kapitel sammelt etablierte Industrie-Standards, die wir bewusst übernehmen, statt eigene Lösungen zu bauen. Reduziert Maintenance, erhöht Tooling-Kompatibilität, beschleunigt Onboarding.

### 19.1 Error-Format: RFC 7807 Problem Details
Statt Eigenbau-Envelope nutzen wir **RFC 7807 (Problem Details for HTTP APIs)**.

**Format:**
```json
{
  "type": "https://errors.example.com/CORE_0100",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Session expired",
  "instance": "/api/v1/projects/123",
  "code": "CORE_0100",
  "errors": [
    { "field": "email", "message": "Invalid format", "code": "VAL_0001" }
  ]
}
```

**Header:** `Content-Type: application/problem+json`

**Implementierung:**
- Globaler `ProblemDetailsExceptionFilter`
- `code`-Feld bleibt für Rückwärts-Kompatibilität / Frontend-Mapping
- `type`-URL muss nicht resolvable sein (kann Doku-Anker sein)
- Error-Code-Format: `CORE_0100` (kein `#`-Marker mehr)

### 19.2 Observability: OpenTelemetry
Pino bleibt als Logger, aber zusätzlich **OpenTelemetry** für Traces + Metrics + Log-Korrelation.

**Stack:**
- `@opentelemetry/auto-instrumentations-node` (Auto-Instrumentation für HTTP, Prisma, Postgres, Redis, Pino)
- OTLP-Exporter (HTTP oder gRPC) — Backend-agnostisch
- W3C Trace Context (`traceparent`-Header) statt Eigenbau-Request-ID
- Pino-Logs werden mit `traceId` und `spanId` angereichert (`@opentelemetry/instrumentation-pino`)

**Backend (austauschbar):**
- Self-Hosted: Grafana LGTM-Stack (Loki + Tempo + Mimir)
- SaaS: Honeycomb, Datadog, Grafana Cloud

**ENV:**
```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=core-api
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
```

### 19.3 Job-Queue: pg-boss (Postgres-native)
Statt Eigenbau-Cron-Tabelle und reinem `@nestjs/schedule` setzen wir **pg-boss** ein — Postgres-basierte Job-Queue ohne externe Dependencies.

**Was pg-boss abdeckt:**
- Cron-Jobs (mit Locking → läuft nur auf einer Instanz)
- Background-Jobs (Email-Versand, Webhook-Dispatch, Image-Processing)
- Retries mit Exponential-Backoff
- Throttling, Rate-Limiting, Priorisierung
- Outbox-Pattern (siehe 19.6)

**Warum nicht BullMQ:** würde Redis als zusätzliche Infrastruktur erfordern. pg-boss nutzt unsere existierende Postgres-Instanz via `pg_advisory_xact_lock`.

**Modul-Skizze:**
```typescript
@Injectable()
export class JobsService {
  async schedule(name: string, data: unknown, opts: ScheduleOptions): Promise<string>;
  async cron(name: string, expression: string, data?: unknown): Promise<void>;
  registerHandler<T>(name: string, handler: (job: Job<T>) => Promise<void>): void;
}
```

### 19.4 Rate-Limiting: `@nestjs/throttler` mit verteiltem Store
Aktuell wäre in-memory pro Prozess → bricht bei Multi-Instance-Deployment.

**Standard:** `@nestjs/throttler` mit pluggable Store.
- **Default:** Postgres-Store (eigene Tabelle mit TTL-Cleanup)
- **Optional:** Redis-Store (wenn Redis ohnehin im Stack)

**Multi-Window:** kombinierte Limits pro Endpoint:
```typescript
@Throttle({
  short: { limit: 10, ttl: 1000 },       // 10/s Spike-Protection
  medium: { limit: 100, ttl: 60000 },    // 100/min normales Limit
  long: { limit: 1000, ttl: 3600000 },   // 1000/h Tagesschutz
})
```

Schlüssel: `userId` (eingeloggt), sonst `ip`.

### 19.5 Security-Headers: Helmet + CSP
Globale Helmet-Middleware mit angepasster CSP:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` — strict default (`default-src 'none'`), nur API-Pfade brauchen wenig CSP, `/docs`-Pfad bekommt Swagger-UI-CSP-Lockerung

### 19.6 Idempotency-Key-Header
Standard-Pattern (Stripe-Style) für alle nicht-idempotenten Endpunkte (`POST`, `PATCH`).

**Flow:**
1. Client setzt `Idempotency-Key: <uuid-v4>` Header
2. Server prüft Cache-Tabelle:
   - Hit + identischer Request-Body → cached Response zurückgeben
   - Hit + abweichender Request-Body → `409 Conflict`
   - Miss → Endpoint ausführen, Response cachen (TTL 24h)

**Datenmodell:**
```prisma
model IdempotencyKey {
  key         String   @id
  userId      String?  @db.Uuid
  requestHash String                       // sha256 von Method+Path+Body
  status      Int
  body        Json
  createdAt   DateTime @default(now())
  expiresAt   DateTime
  @@index([expiresAt])
}
```

**Anwendung:** `@RequireIdempotencyKey()` Decorator markiert kritische Endpunkte.

### 19.7 Soft-Delete als First-Class-Konzept
Alle Domain-Tabellen (außer Audit-Log, Sessions, Verifikations-Token) bekommen:
```prisma
deletedAt    DateTime?
deletedBy    String?  @db.Uuid
```

**Prisma-Extension:**
- Auto-Filter `deletedAt: null` auf alle `find*`-Operationen
- `delete()` → `update({ deletedAt: now() })` (soft)
- Hard-Delete via expliziter Method `hardDelete()` (admin-only, mit Audit-Eintrag)
- Restore via `restore(id)` → setzt `deletedAt: null`
- RLS-Policies erweitern: `deletedAt IS NULL OR <admin-bypass>`

**Permission-Integration:** Action `RESTORE` und `HARD_DELETE` ergänzen `PermissionAction`-Enum.

### 19.8 GDPR-Compliance-Endpoints
Pflicht nach DSGVO Art. 15 (Auskunft) + Art. 17 (Löschung).

| Endpoint | Beschreibung |
|---|---|
| `GET /me/export` | Async-Job, generiert ZIP/JSON-Archiv aller Nutzerdaten, Download via signed URL |
| `DELETE /me/account` | Initiiert Account-Löschung, optionale Grace-Period (default 30 Tage) |
| `POST /me/account/cancel-deletion` | Während Grace-Period: Löschung abbrechen |
| `GET /me/data-processing` | Liste aller Verarbeitungstätigkeiten (Audit-Log-Auszug) |

**Implementierung:**
- Export-Job läuft via pg-boss (kann groß werden)
- Account-Deletion = Hard-Delete (oder Anonymisierung bei rechtlichen Aufbewahrungspflichten)
- Anonymisierung: PII-Felder (`email`, `name`, `phone`) → `null` oder Hash, Foreign-Keys bleiben

### 19.9 UUID v7 statt v4
**Begründung:** v7 ist zeitsortiert (RFC 9562, 2024) → bessere B-Tree-Index-Performance in Postgres (kein Page-Splitting durch random IDs), zusätzlich implizite Insert-Reihenfolge ohne Extra-Spalte.

**Implementierung:**
- Library: `uuidv7`-NPM oder Postgres-Extension `pg_uuidv7`
- Prisma: `@default(dbgenerated("uuid_generate_v7()"))` mit Postgres-Extension
- Format bleibt UUID — keine API-Breaking-Changes

### 19.10 Optimistic Concurrency: ETag / If-Match
Schutz vor Lost-Updates bei parallelen Edits:
- Response liefert `ETag: "v3"` (basierend auf `version`-Spalte oder `updatedAt`)
- Client schickt `If-Match: "v3"` beim Update
- Mismatch → `412 Precondition Failed`

**Datenmodell:** `version: Int @default(0)` Spalte auf allen Update-relevanten Modellen, automatisch via Prisma-Extension hochgezählt.

### 19.11 Pagination: Hybrid (page/limit + cursor)
**Default für UI-Listen:** `?page=1&limit=25` (max 1000)
**Für Bulk/Sync:** `?starting_after=<id>&limit=100` (Cursor-Style, Stripe-kompatibel)

**Response-Meta:**
```json
{
  "data": [...],
  "meta": { "total": 1234, "page": 1, "pageCount": 50, "limit": 25 }
}
```
Plus `Link`-Header (RFC 5988):
```
Link: <https://api.example.com/projects?page=2>; rel="next",
      <https://api.example.com/projects?page=50>; rel="last"
```

### 19.12 Outbox-Pattern für reliable Events
Vermeidet das Dual-Write-Problem (DB-Commit OK, Event-Push schlägt fehl).

**Pattern:**
1. In derselben Transaction: Domain-Daten + Outbox-Eintrag schreiben
2. pg-boss-Worker pollt Outbox, dispatcht Event (Webhook, Search-Index, Email)
3. Erfolg → Outbox-Eintrag als `processed` markieren

**Datenmodell:**
```prisma
model OutboxEvent {
  id          String   @id @default(uuid()) @db.Uuid
  eventType   String                          // "project.created"
  aggregateId String?  @db.Uuid
  payload     Json
  status      OutboxStatus @default(PENDING)
  attempts    Int      @default(0)
  lastError   String?
  createdAt   DateTime @default(now())
  processedAt DateTime?
  @@index([status, createdAt])
}
enum OutboxStatus { PENDING PROCESSING DONE FAILED }
```

### 19.13 Repository-Pattern (Prisma kapseln)
Services rufen **nicht** direkt `this.prisma.project.findMany()` auf, sondern gehen über einen dünnen Repository-Layer.

**Vorteile:**
- Query-Logik wiederverwendbar
- Repository in Tests mockbar (statt komplettes `PrismaClient`)
- Permission-Filter (aus `PermissionContext`) zentral angewandt
- Soft-Delete-Filter zentral

**Pattern:**
```typescript
@Injectable()
export class ProjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyForUser(userId: string, ctx: PermissionContext): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { AND: [ctx.itemFilter, { deletedAt: null }] },
      orderBy: { createdAt: 'desc' },
    });
  }
}
```

### 19.14 DB-Naming: snake_case via Prisma-`@map`
Prisma-Schema bleibt camelCase (TypeScript-idiomatisch), Postgres-Tabellen/Spalten sind snake_case (Postgres-idiomatisch, kein Quoting nötig).

```prisma
model FileFolder {
  id        String   @id @default(uuid()) @db.Uuid
  parentId  String?  @map("parent_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")
  @@map("file_folders")
}
```

**Rule:** **alle** Models bekommen `@@map`, **alle** Felder mit Camel-Case bekommen `@map`.

### 19.15 Modular-Monolith mit harten Boundaries
- Pro Domain ein NestJS-Modul (`UsersModule`, `ProjectsModule`, …)
- Module exportieren **nur** Public-Service-Interfaces, keine Repositories oder internen Helper
- Cross-Module-Calls **nur** über öffentliche Service-Methoden, **niemals** direkte Prisma-Cross-Module-Queries
- Spätere Service-Extraction (Microservice) wird einfacher

### 19.16 Naming-Konventionen
**TypeScript / API:**
| Element | Konvention | Beispiel |
|---|---|---|
| DateTime-Felder | `*At` Suffix | `createdAt`, `publishedAt` |
| Boolean-Felder | `is*` / `has*` / `can*` Prefix | `isPublic`, `hasAvatar`, `canEdit` |
| ID-Felder | `*Id` Suffix | `userId`, `tenantId` |
| Count-Felder | `*Count` Suffix | `memberCount` |
| REST-Resources | Plural | `/projects`, `/files` |
| Action-Endpoints | kebab-case nach Resource | `POST /projects/:id/archive` |
| Internal Endpoints | unter `/_internal/*` | `/_internal/metrics` |

**Postgres (via `@map`):**
- snake_case durchgängig
- Tabellen Plural (`file_folders`)
- Foreign-Keys: `<resource>_id` (`tenant_id`)

### 19.17 API-Stability-Promise
- `/v1/*` — SemVer-stabil. Breaking Changes nur mit neuer Major-Version.
- `/v1-preview/*` — Preview-Features, breaking ohne Vorwarnung.
- Deprecation: `Sunset: <RFC-9651-date>` Header (RFC 8594) + `Deprecation: true` (RFC 9745). Mindestens 6 Monate Vorlauf.
- Breaking Changes immer mit Migration-Guide.

### 19.18 Container-Standards (Template-Referenz für konsumierende Projekte)

> **Wichtig:** Das Template-Repo selbst wird **nicht** als Docker-Image gebaut oder publiziert. Konsumierende Projekte adaptieren das untenstehende Dockerfile-Skelett für ihren Production-Build. Local-Dev läuft nativ via `bun --watch` + portless (siehe Kap. 27).

**Runtime: Bun statt Node** — kleineres Image, schnellerer Start, native TypeScript-Ausführung.

**Multi-Stage-Dockerfile** (`Dockerfile.example` als Vorlage):
```dockerfile
# syntax=docker/dockerfile:1.7
ARG BUN_VERSION=1.2-alpine

# ---------- Stage 1: Dependencies ----------
FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production=false

# ---------- Stage 2: Build ----------
FROM oven/bun:${BUN_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bunx prisma generate
RUN bun run build
RUN bun install --frozen-lockfile --production

# ---------- Stage 3: Runtime ----------
FROM oven/bun:${BUN_VERSION} AS runtime
WORKDIR /app

# Non-root user
RUN addgroup -g 1001 app && adduser -D -u 1001 -G app app
USER 1001:1001

# Build artifacts + production deps only
COPY --from=builder --chown=1001:1001 /app/dist ./dist
COPY --from=builder --chown=1001:1001 /app/node_modules ./node_modules
COPY --from=builder --chown=1001:1001 /app/package.json ./
COPY --from=builder --chown=1001:1001 /app/prisma ./prisma

ENV NODE_ENV=production \
    PORT=3000 \
    OTEL_SERVICE_NAME=core-api

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD bun -e "fetch('http://localhost:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "dist/main.js"]
```

**Standards:**
- `USER 1001:1001` (non-root)
- `HEALTHCHECK` über `/health/ready`
- Image-Signing via `cosign` in CI
- Renovate-Bot pinnt Base-Image-Digest
- `.dockerignore` schließt `node_modules`, `.env`, `dist`, `tests` aus
- SBOM-Generierung via `syft` in CI

### 19.19 Standard `docker-compose.yml` (Development)

Komplett-Stack out-of-the-box. Frischer Clone → `docker compose up` → läuft.

```yaml
name: core-api

services:
  app:
    build:
      context: .
      target: runtime
    image: core-api:dev
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: develop
      DATABASE_URL: postgres://app:app@postgres:5432/app
      BASE_URL: http://localhost:3000
      APP_URL: http://localhost:3001
      BETTER_AUTH_SECRET: dev_dev_dev_dev_dev_dev_dev_dev_
      ENCRYPTION_MASTER_KEY: dev_dev_dev_dev_dev_dev_dev_dev_dev_dev_aA=
      STORAGE_DEFAULT: s3-default
      STORAGE_S3_DEFAULT_DRIVER: s3
      STORAGE_S3_DEFAULT_ENDPOINT: http://rustfs:9000
      STORAGE_S3_DEFAULT_REGION: us-east-1
      STORAGE_S3_DEFAULT_BUCKET: files
      STORAGE_S3_DEFAULT_KEY: rustfs
      STORAGE_S3_DEFAULT_SECRET: rustfs-secret
      STORAGE_S3_DEFAULT_FORCE_PATH_STYLE: "true"
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_SERVICE_NAME: core-api
      SMTP_HOST: mailpit
      SMTP_PORT: 1025
    depends_on:
      postgres: { condition: service_healthy }
      rustfs:   { condition: service_healthy }
    healthcheck:
      test: ["CMD", "bun", "-e", "fetch('http://localhost:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./scripts/postgres-init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 10s
      timeout: 3s
      retries: 5

  rustfs:
    # S3-kompatibler Object-Storage, Self-Hosted-Default
    image: rustfs/rustfs:latest
    environment:
      RUSTFS_ROOT_USER: rustfs
      RUSTFS_ROOT_PASSWORD: rustfs-secret
      RUSTFS_VOLUMES: /data
    ports:
      - "9000:9000"   # S3 API
      - "9001:9001"   # Console
    volumes:
      - rustfs-data:/data
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:9000/minio/health/live"]
      interval: 15s
      timeout: 5s
      retries: 5

  rustfs-init:
    # Erstellt Bucket beim ersten Start
    image: minio/mc:latest
    depends_on:
      rustfs: { condition: service_healthy }
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://rustfs:9000 rustfs rustfs-secret;
      mc mb -p local/files || true;
      mc anonymous set download local/files/public || true;
      exit 0;
      "

  mailpit:
    # Email-Testing in Dev — fängt SMTP, zeigt UI
    image: axllent/mailpit:latest
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # UI
    environment:
      MP_MAX_MESSAGES: 5000

  otel-collector:
    # OTLP-Receiver, leitet weiter an Backend (Tempo, Jaeger, Honeycomb)
    image: otel/opentelemetry-collector-contrib:latest
    command: ["--config=/etc/otel/config.yaml"]
    volumes:
      - ./scripts/otel-config.yaml:/etc/otel/config.yaml:ro
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP

  pgadmin:
    # Optional, dev-profile only
    profiles: ["tools"]
    image: dpage/pgadmin4:latest
    environment:
      PGADMIN_DEFAULT_EMAIL: dev@example.com
      PGADMIN_DEFAULT_PASSWORD: dev
    ports:
      - "5050:80"
    depends_on:
      postgres: { condition: service_healthy }

volumes:
  postgres-data:
  rustfs-data:
```

**Postgres-Init-Script** (`scripts/postgres-init.sql`):
```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_uuidv7;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- Fallback
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- für ILIKE-Performance + Search-Fallback

-- App-Rolle für RLS-Tests (Prisma nutzt Owner für Migrations, App-Rolle für Runtime)
-- Optional in Dev, Pflicht in Production
```

**Profile-Setup:**
- `docker compose up` — App + DB + RustFS + Mailpit + OTel
- `docker compose --profile tools up` — zusätzlich pgAdmin
- `docker compose --profile prod up` (nicht in diesem File, separate `docker-compose.prod.yml`)

### 19.20 Production-Compose-Variante (`docker-compose.prod.yml.example`)

> Wieder: **Vorlage für Konsumenten**, im Template-Repo nur als Beispiel committed.

- Image-Tag statt Build (`image: registry.example.com/<consumer-project>:1.2.3`)
- Secrets via Docker-Secrets oder `env_file: .env.prod` (außerhalb des Repos)
- Postgres + RustFS extern (Managed-Service oder dedizierter Server)
- Reverse-Proxy (Caddy/Traefik) für TLS-Termination und HTTP/2
- Multiple App-Replicas via `deploy.replicas: 3`
- Resource-Limits (`deploy.resources.limits`)

---

## 30. Sicherheits-Mechanismen (Übersicht)

| Layer | Mechanismus |
|---|---|
| **Network** | TLS-Termination via Reverse-Proxy, HSTS-Header |
| **Application Boot** | ENV-Validation (Zod), `assertCookiesProductionSafe()`, Fail-Fast |
| **CORS** | Auto-derived aus `BASE_URL`/`APP_URL`, opt-in `allowedOrigins[]` |
| **Cookies** | httpOnly, Secure, SameSite=Lax (default) oder Strict, signed |
| **Auth** | Better-Auth (JWT + Sessions), 2FA, Passkey, Rate-Limiting, Brute-Force-Lockout |
| **API-Keys** | argon2id-Hash, Scopes, Auto-Expiry, Rotation mit Grace-Period, Revocation |
| **Authorization** | CASL-Engine + DB-konfigurierbare Permissions, Field-Level + Item-Level + Validation |
| **Output-Pipeline** | 4-Stage: Translate → CASL-Field-Whitelist → Filter-Service → Secret-Safety-Net |
| **Secret-Safety-Net** | Globale Strip-Liste + Regex-Patterns (`*Hash`, `*Secret`, `*Token`), Pflicht-Last-Resort |
| **Field-Encryption** | AES-256-GCM für PII / Secrets, Key-Versioning, Blind-Index optional |
| **Webhooks** | HMAC-SHA256-Signatur (Standard-Webhooks-Spec), Replay-Protection, Auto-Disable |
| **Realtime** | Permission-aware Room-Filter, Auth-Handshake, Heartbeat-Disconnect |
| **Mobile-Sync** | Sync-Rules ⊆ READ-Permissions, Writes durch CASL, JWT-Audience-Validation, Encrypted-Felder excluded |
| **Geo-Daten** | Adressen als PII (Field-Encryption), Geocoding-Rate-Limiting, GeocodingCache-Anonymisierung bei DSGVO-Erasure |
| **MCP** | OAuth 2.1 Bearer-Token (Better-Auth-OAuth-Provider, PKCE), strikte Zod-Input-Validation, Output-Truncation, Audit-Log |
| **Tenant-Isolation** | App-Layer (Interceptor) + DB-Layer (RLS) |
| **Input** | Zod-Validation (Pipe), Mime-Magic-Byte-Check für Files |
| **Output** | Field-Filtering basierend auf Permission (allowed fields), Audit-fields nie überschreibbar |
| **DB** | RLS, Prisma-Audit-Extension, Foreign-Keys mit `ON DELETE` |
| **Files** | Mime-Whitelist, Magic-Byte, Antivirus-Hook (optional), Path-Traversal-Schutz, Signed-URLs |
| **Logging** | Pino + OpenTelemetry, W3C Trace Context, kein PII in Logs |
| **Rate-Limiting** | `@nestjs/throttler` mit Postgres-Store, Multi-Window (1s / 1min / 1h) |
| **Headers** | Helmet (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, CSP) |
| **Idempotenz** | `Idempotency-Key`-Header (RFC-Standard), Cache-TTL 24h |
| **Optimistic Lock** | `ETag` / `If-Match` für Updates, `version`-Spalte |
| **Errors** | RFC 7807 Problem Details (`application/problem+json`) |
| **Container** | (Template-Referenz — pro konsumierendem Projekt umgesetzt) Multi-Stage-Build, Distroless-Runtime, non-root, Image-Signing |
| **Secrets** | Niemals in Code, Better-Auth-Secret 32+ Zeichen Pflicht, Rotation möglich |
| **Dependencies** | `bun audit` / `pnpm audit`-Gate in CI, Renovate-Bot, Pinned-Versions |
| **KMS / Keys** | KEK in ENV/Vault, Better-Auth-Secret separat, Webhook-Secrets encrypted-at-rest |

---

## 31. Datenmodell-Initial (Prisma Schema Skizze)

```prisma
// Auth (Better-Auth managed)
model User { ... }
model Account { ... }
model Session { ... }
model VerificationToken { ... }
model TwoFactor { ... }
model Passkey { ... }
model Jwks { ... }
model ApiKey { ... }                  // Scoped Service-Account-Keys

// Tenancy
model Tenant { ... }
model TenantMember { ... }

// Permissions
model Role { ... }
model Policy { ... }
model RolePolicy { ... }
model Permission { ... }

// Files
model FileFolder { ... }
model File { ... }
model FileBlob { ... }                // Postgres-Adapter (Large Objects)
model AssetPreset { ... }

// Webhooks
model WebhookEndpoint { ... }
model WebhookDelivery { ... }

// Realtime (optional, sonst zustandslos)
model RealtimeSubscription { ... }

// Geo (optional, nur wenn features.geo aktiv) — PostGIS-Extension nötig
model Address { ... }                 // mit geometry(Point, 4326)
model Geofence { ... }                // mit geometry(Polygon, 4326)
model GeocodingCache { ... }

// Mobile-Offline-Sync (PowerSync) — optional, nur Tabellen die Postgres-seitig nötig sind
// Sync-State liegt im PowerSync-Service, nicht in unserer DB.
// Optional: pro Device ein Audit-Eintrag
model PowerSyncDevice { ... }      // userId, deviceId, lastSyncAt, syncRulesVersion

// Audit & Reliability
model AuditLog { ... }
model OutboxEvent { ... }
model IdempotencyKey { ... }

// System
model ScheduledJob { ... }
model Setting { id String @id; key String @unique; value Json }
```

---

## 32. Implementierungs-Phasen (vorgeschlagen)

> Phasen sind so aufgeteilt, dass nach jeder Phase ein **brauchbares Template** existiert, das echte Projekte mit reduziertem Feature-Set bereits nutzen können. Optional-Module (Phase 5b, 6, MCP) können auch nach Live-Gang eines konkreten Projekts nachgezogen werden.

> **TDD-Pflicht (Kap. 28b):** Jede Phase beginnt mit dem Anlegen der Tests. Für jedes Feature in den Checklisten unten gilt: **erst Story-/E2E-Test (`tests/stories/<feature>.story.test.ts` oder `tests/<feature>.e2e-spec.ts`) schreiben (Red), dann implementieren (Green), dann refactoren.** Pro Phase ist ein expliziter „Test-Setup"-Bullet gelistet.

### Phase 1 – Foundation (Sprint 1-2)
- [x] **Test-Infrastruktur:** `tests/`-Layout (`stories/`, `unit/`, `types/`, `migrate/`, `k6/`), `global-setup.ts` mit `testcontainers`-Postgres, Vitest-Config, npm-Scripts (`test`, `test:watch`, `test:unit`, `test:e2e`, `test:types`, `test:coverage`)
- [x] **TestHelper** (Builder für authentifizierte Test-Requests, parallel-sichere Test-User mit UUID-Suffix, ID-basiertes Cleanup)
- [x] **Coverage-Gate** (≥ 90 % auf `src/core/`, ≥ 80 % auf `src/modules/`) in `.gitlab-ci.yml`
- [x] Adaptierte Stories aus nest-server: `error-code.story.test.ts`, `cookies-cors-config.spec.ts`, `cookies-security-property.e2e-spec.ts`, `system-setup.e2e-spec.ts`, `server.e2e-spec.ts`
- [x] Projekt-Skeleton (Bun + NestJS + Prisma + Postgres)
- [x] ENV-Validation (Zod) + Config-Modul
- [x] Feature-Flag-System (`features.ts` + Conditional-Imports + Validierung von Abhängigkeiten)
- [x] Logger (Pino) + OpenTelemetry-Integration  *(Pino-Logger ist als `LoggerService` in `bootstrap()` verdrahtet; NestJS-Lifecycle-Logs gehen strukturiert via Pino raus. OTel-SDK-Init ist als optionaler Hook in `initObservability` vorbereitet — Default ist Noop, aktiviert via `features.observability.enabled` + injizierter `sdkFactory`.)*
- [x] Helmet + CSP-Middleware
- [x] Request-Context-Middleware (W3C Trace Context)  *(in `AppModule.configure()` registriert; `x-request-id` + `traceparent` werden auf jeder Response gesetzt; e2e-Test in `tests/request-context.e2e-spec.ts` deckt das ab.)*
- [x] Health-Check (Liveness + Readiness)
- [x] RFC 7807 Problem-Details Exception-Filter
- [x] `Dockerfile.example` als Template-Referenz für Konsumenten (Multi-Stage Bun, non-root) — wird **nicht** in CI gebaut
- [x] Docker-Compose-Setup nur für Projekt-Dependencies (Postgres + RustFS + Mailpit + OTel-Collector); der Server selbst läuft nativ über `bun --watch`
- [x] [portless](https://github.com/vercel-labs/portless) integriert: `portless.yml` mit `<service>.<project>.localhost`-Routing, Auto-HTTPS (mkcert), `bun run dev` startet portless implizit; Fallback auf dynamischen Port wenn portless fehlt
- [x] Repo-Layout: `src/core/` (Template-Owned, Sync-Target) + `src/modules/` (Projekt-Owned) + `src/shared/` (gemeinsame Types)
- [x] Prisma-Schema v1 (User, Tenant, Role) mit `@@map`/`@map` snake_case
- [x] UUID v7 Setup (Postgres-Extension `pg_uuidv7`)
- [x] Field-Encryption-Service (AES-256-GCM, KEK aus ENV)  *(`FieldEncryptionService` ist `@Injectable`; `EncryptionModule.forRoot()` provided ihn + den `KEK_PROVIDER`-Token. In `AppModule` conditional-imported wenn `features.fieldEncryption.enabled`. KEK kommt aus `FIELD_ENCRYPTION_KEK`-env, lazy-validiert.)*

### Phase 2 – Auth & Multi-Tenancy (Sprint 3-4)
- [x] **Test-First (Stories):** Adaptierte `better-auth-*.story.test.ts` (api, integration, plugins, jwt-middleware, rate-limit, email-verification), `auth-parallel-operation.e2e-spec.ts`, `auth-scenarios.e2e-spec.ts`, `user-enumeration-prevention.e2e-spec.ts`, `multi-tenancy.e2e-spec.ts`, `tenant-guard.e2e-spec.ts` — vor jeder Implementation
- [x] Better-Auth Integration (Email/PW, Session, JWT)  *(`BetterAuthModule` baut die Auth-Instanz lazy via `useFactory` und mountet `BetterAuthController` mit `@All('*splat')` → `toNodeHandler(auth)` auf `/api/auth/*`. Plugin-Auswahl (`twoFactor`/`passkey`/`socialProviders`) folgt `features.authMethods`. Storage: in-memory Adapter; Prisma-Adapter folgt mit Schema-Slice. Ohne `BETTER_AUTH_SECRET` ≥ 32 Zeichen → 503 statt Crash.)*
- [ ] System-Setup (Initial-Admin)  — *Config-Parsing funktioniert, aber kein Boot-Hook ruft `provisionAdmin()`.*
- [ ] Tenant-Interceptor + RLS-Setup  — *`TenantInterceptor` (@Injectable) ist da, aber nicht global registriert; RLS-`SET LOCAL`-Hook nicht im PrismaService verdrahtet.*
- [ ] Tenant-Member-CRUD  — *Kein Controller.*
- [ ] Scoped API-Keys (CRUD, argon2id-Hash, Scopes, Rotation)  — *Kein Controller, Hashing-Helper existiert isoliert.*
- [x] Repository-Pattern als Standard etablieren

### Phase 3 – Permissions & Output-Pipeline (Sprint 5-6)
- [x] **Test-First (Stories):** `permissions-report.e2e-spec.ts`, `safety-net.spec.ts` + `safety-net.e2e-spec.ts`, `remove-secrets.spec.ts`, `pagination-metadata.story.test.ts`, `map-and-validate.pipe.e2e-spec.ts` — vor jeder Implementation
- [x] Role / Policy / Permission Models
- [x] CASL Integration (`@casl/ability`, `@casl/prisma`)
- [x] DB-Rule → CASL-Rule Resolver (mit Variablen-Substitution)
- [x] PermissionService.abilityFor() + Cache (LRU, 60s TTL)
- [ ] `@Can()` Decorator + Guard, `@Ability()` Param-Decorator  — *Decorator + `CanGuard` existieren, Guard ist nicht als globaler `APP_GUARD` registriert.*
- [ ] PostgREST-Query-Parser → Prisma-WHERE (kombiniert mit `accessibleBy`)  — *Parser existiert, aber kein Controller verwendet ihn.*
- [x] Output-Pipeline-Interceptor (4-Stage)  *(`OutputPipelineInterceptor` ist als globaler `APP_INTERCEPTOR` registriert; Stages 3+4 (remove-secrets + safety-net) laufen auf jeder Response. Stages 1+2 (record-level Permission-Filter + Field-Allowlist) aktivieren sich, sobald per Request eine `Ability` resolvbar ist — passiert mit Auth-Slice.)*
- [ ] Filter-Service Pattern: `@FilterFor()` + Registry + Auto-Discovery  — *`FilterService` (@Injectable) existiert, aber keine Auto-Discovery via `DiscoveryModule`/`MetadataScanner`.*
- [x] Secret-Safety-Net mit globaler Liste + Regex-Patterns
- [ ] Admin-CRUD-Endpoints für Roles/Policies/Permissions + Test-Endpunkt  — *Keine Controller.*
- [x] Soft-Delete Prisma-Extension (inkl. `RESTORE`/`HARD_DELETE` Actions)

### Phase 4 – Files (Sprint 7-8)
- [x] **Test-First (Stories):** `file.e2e-spec.ts`, `tus-upload.story.test.ts`, `tus-file-type-validation.spec.ts` — vor jeder Implementation
- [x] Storage-Adapter-Interface
- [x] S3-Adapter (RustFS-getestet)
- [x] Local-Adapter
- [x] Postgres-Adapter (Large Objects + `FileBlob`-Modell + RLS)
- [ ] File/Folder Models + CRUD-Endpoints  — *Models in Prisma vorhanden, kein Controller.*
- [ ] Multipart-Upload + TUS  — *@tus/server-Wiring fehlt; kein Mount im Express-Layer.*
- [ ] Asset-Endpoint mit Transformations + Cache (`sharp`)  — *Helper existieren, kein Controller.*
- [x] Asset-Presets

### Phase 5 – Realtime, Search, Webhooks (Sprint 9-10)
- [x] **Test-First (Stories):** Webhook-Delivery (HMAC-Sig, Retry, Auto-Disable), Webhook-Master/Sub-Job-Fanout, FTS-Search-Edge-Cases, Realtime-Permission-aware-Channels, Outbox-Pattern — eigene Stories pro Feature, keine direkten 1:1-Übernahmen aus nest-server (dort fehlen vergleichbare Tests)
- [ ] pg-boss Job-Queue + Worker-Setup  — *Kein Boot-Hook, der pg-boss startet; `pg-boss` ist nicht mal in dependencies.*
- [ ] Outbox-Pattern (Events)  — *`OutboxRecorder`/`OutboxWorker` existieren als pure Klassen, ohne DI-Provider/Boot.*
- [x] Webhooks: `WebhookEndpoint` + `WebhookDelivery` Models
- [ ] Webhook-Dispatcher (HMAC-SHA256, Retries, Auto-Disable)  — *Klasse existiert, kein Worker/Subscriber konsumiert die Outbox.*
- [x] Search: `Searchable`-Decorator + Migration-Generator (tsvector + GIN)
- [ ] Cross-Resource-Search-Endpoint  — *Service existiert, kein Controller.*
- [ ] Realtime-Service (Postgres LISTEN-Connection)  — *Service-Klasse existiert, kein DI-Provider, keine Connect-Lifecycle-Hook.*
- [ ] Socket.IO-Gateway + Auth-Handshake + Room-Subscriptions  — *Keinerlei `@WebSocketGateway` im Code.*
- [ ] Permission-Aware Channel-Filter  — *Filter-Funktion existiert, ohne Verwendung im Gateway.*

### Phase 5c – Geo & Standortdaten (PostGIS, optional, nur wenn `features.geo` aktiv)
- [x] **Test-First (Stories):** Geocoding-Provider-Switch (Mapbox/Nominatim/Local-Stub), GeoJSON-Output-Mapping (Stage 3a der Output-Pipeline), `findNearby`/`withinGeofence`-Queries auf GIST-Indizes, GeocodingCache-TTL + DSGVO-Erasure, Address-PII-Encryption-Roundtrip — eigene Stories, keine 1:1-Übernahmen aus nest-server (kein Geo-Modul dort)
- [x] PostGIS-Extension via Migration aktivieren
- [x] Geo-Schema (`prisma/features/geo.prisma`) mit `Address`, `Geofence`, `GeocodingCache`
- [x] GIST-Indizes via raw-SQL-Migration
- [x] `GeocodingProvider` Interface + Adapter (Mapbox, Nominatim, Google, Local-Stub)
- [x] `GeoService` (geocode, reverseGeocode, findNearby, withinGeofence, distance)
- [ ] REST-Endpunkte (`/geo/*`, `/addresses`, `/geofences`, generisches `/places/nearby`)  — *Keine Controller.*
- [ ] GeoJSON-Output-Mapper in Output-Pipeline integrieren (Stage 3a)  — *Mapper-Funktion existiert, aber Output-Pipeline-Interceptor läuft nicht (siehe Phase 3).*
- [ ] GeocodingCache + Cleanup-Cron (90 Tage TTL)  — *Cleanup-Planner existiert, kein `@Cron`-Job ist in DI registriert.*
- [ ] Field-Encryption-Integration für Adress-PII-Felder (street, zip)  — *`encryptAddress`/`decryptAddress` existieren, sind aber nicht in CRUD-Pfaden integriert.*
- [x] Frontend-SDK-Types für Point/Polygon/FeatureCollection (via OpenAPI)

### Phase 5b – Mobile-Offline-Sync (PowerSync, optional)
- [x] **Test-First (Stories):** Sync-Rules ⊆ READ-Permissions (User sieht nur eigene Buckets), Better-Auth-JWT mit `audience: powersync` + JWKS-Verify, Upload-Controller-Konflikt-Resolution, Encrypted-Fields-Exclusion aus Sync-Buckets, Tenant-Bucket-Isolation — eigene Stories, keine 1:1-Übernahmen aus nest-server (kein PowerSync-Modul dort)
- [x] Postgres logical replication aktivieren (`wal_level = logical`)
- [x] Replication-Role + Publication für PowerSync
- [x] PowerSync Service in Docker-Compose
- [x] `sync-rules.yaml` mit User/Tenant-Buckets
- [ ] Better-Auth JWT-Plugin: `audience: powersync` + JWKS-Endpoint  — *Config-Planner + Endpoint-Metadata existieren, aber Better-Auth-Instanz wird nirgends erzeugt; kein `/.well-known/jwks` Controller.*
- [ ] PowerSync-Upload-Controller (`POST /powersync/crud`)  — *Zod-Validator existiert, kein NestJS-Controller.*
- [ ] Konflikt-Resolution-Hook in BaseRepository  — *Pure `resolvePowerSyncConflict()`-Planner existiert, BaseRepository ruft ihn nicht auf.*
- [x] Encrypted-Fields explizit aus Sync-Rules ausschließen
- [x] React-Native Demo-Client + Upload-Backend-Test  *(in-memory simulator, der den Upload-Flow durchspielt — RN-Repo separat)*

### Phase 6 – Email, 2FA, Passkey, MCP (Sprint 11)
- [x] **Test-First (Stories):** `email-service.e2e-spec.ts` adaptiert (Mailpit-Trap), 2FA-Story (TOTP-Setup + Verify), Passkey-Story (WebAuthn-Register/Login), MCP-OAuth-Story (Authorization-Code + PKCE, Tool-Call mit Permission-Filter)
- [ ] Email-Service (Nodemailer + Brevo)  — *Klasse existiert, kein DI-Provider; Nodemailer/Brevo-Deps nicht installiert.*
- [x] Email-Templates (verify, reset, welcome, invitation)
- [ ] 2FA-Endpunkte aktivieren  — *Plugin-Liste existiert (`listAuthPluginNames`), Better-Auth-Instanz wird nicht erzeugt → `/api/auth/two-factor/*` nicht erreichbar.*
- [ ] Passkey-Endpunkte aktivieren  — *Plugin-Liste enthält `passkey`, kein Mount.*
- [ ] Social-Login-Provider  — *Config-Plumbing vorhanden, kein Mount.*
- [ ] MCP-Server-Modul (`@modelcontextprotocol/sdk`)  — *Kein NestJS-Modul, MCP-SDK ist installiert aber nicht angeschlossen.*
- [ ] `@McpTool`/`@McpResource`-Decorators + Auto-Discovery  — *Decorators existieren, keine Discovery-Logic in DI.*
- [ ] MCP-Auth via Better-Auth-OAuth-Provider (Authorization-Code-Flow + PKCE)  — *Better-Auth nicht montiert.*

### Phase 7 – Reliability, Template-Tooling & Polish (Sprint 12)
- [x] **Test-First (Stories):** Setup-Wizard (Idempotenz, abbrechbar, korrektes `.env`-Output), Schema-Konkatenation (nur aktive Features kombiniert), `sync:from-template` (lässt `src/modules/` unangetastet), `sync:to-template` (Patch aus `src/core/`-Diff korrekt) — eigene Stories
- [x] Setup-Wizard (`bun run setup`) für interaktive Projekt-Initialisierung
- [ ] Schema-Konkatenations-Skript (`bun run prepare:schema` → kombiniert nur aktivierte Feature-Schemas)  — *`scripts/prepare-schema.ts` existiert nicht; package.json-Eintrag wäre kaputt.*
- [ ] Template-Sync-Skript `bun run sync:from-template`  — *`scripts/sync-from-template.ts` existiert nicht (Planner ja, Runner nein).*
- [ ] Core-PR-Workflow `bun run sync:to-template`  — *`scripts/sync-to-template.ts` existiert nicht (Planner ja, Runner nein).*
- [x] Dokumentation: Template-Update-Workflow, Pro-Projekt-Customization-Guide, Core-Contribution-Guide (PR-zurück-Workflow)

### Phase 8 – Developer Experience (parallel ab Phase 3, finalisieren in Sprint 13)
- [x] **Test-First (Stories):** Idempotency-Key (Cache-Hit/Miss), ETag/If-Match (Optimistic-Concurrency), Cursor-Pagination, Throttler (Multi-Window, Postgres-Store), GDPR-Endpoints (Export, Delete, Anonymize), Audit-Log (Create/Update/Delete-Tracking)
- [ ] **Scalar** als API-UI (statt Swagger UI) — `@scalar/nestjs-api-reference`  — *Config-Helper existiert, kein Mount.*
- [ ] **NestJS DevTools** Integration (`@nestjs/devtools-integration` + Snapshot-Mode)  — *Snapshot-Module nicht in AppModule importiert.*
- [x] **Dev-Hub** Landing-Page `/dev` mit Auto-Discovery aktiver Tools  *(`DevHubController` rendert HTML aus `planDevHub()`-Output, kategorisiert nach api/architecture/data/async. Außerhalb `NODE_ENV=development` 404. e2e-Test in `tests/dev-hub.e2e-spec.ts`.)*
- [ ] **Permission-Tester** UI (`/admin/permissions/test`)  — *HTML-Renderer existiert, kein Controller.*
- [ ] **Webhook-Inspector** (Delivery-Log + Re-Deliver)  — *HTML-Renderer existiert, kein Controller.*
- [ ] **Realtime-Inspector** (Active Sockets + Live-Stream)  — *HTML-Renderer existiert, kein Gateway / kein Controller.*
- [ ] **Audit-Browser** (Filter + Diff-Anzeige)  — *HTML-Renderer existiert, kein Controller.*
- [ ] **Search-Tester** (FTS-Probier-UI)  — *HTML-Renderer existiert, kein Controller.*
- [x] **Diagnostik-Endpoint** `/dev/diagnostics`  *(JSON-Endpoint im `DevHubController`; nutzt `buildDiagnosticsReport()` mit aktuellen process/memory/features-Werten. Plus `/dev/features` für rohe Features-JSON. Beide 404 außerhalb development.)*
- [x] **`.vscode/` Defaults** (Extensions, Launch-Configs, Tasks)
- [ ] **`bun run onboard`** Skript für neue Entwickler  — *Skript existiert nicht.*
- [ ] **SDK-Generation** (`bun run sdk:generate` via kubb)  — *Kubb-Config existiert; ohne Controller liefert der Server kein OpenAPI-Spec → Generator ohne Input.*
- [ ] Idempotency-Key Interceptor + Tabelle  — *Service+Tabellen-Typen vorhanden, Interceptor nicht als globaler `APP_INTERCEPTOR` registriert.*
- [ ] ETag / If-Match Optimistic-Concurrency-Pipe  — *Helper-Funktionen existieren, kein Pipe/Interceptor in DI.*
- [ ] Cursor-Pagination zusätzlich zu page/limit  — *Pagination-Helper vorhanden, keine Controller verwenden ihn.*
- [ ] `@nestjs/throttler` mit Postgres-Store, Multi-Window  — *Postgres-Store-Klasse existiert, ThrottlerModule ist nicht in AppModule.*
- [ ] Per-API-Key Rate-Limit-Bucket  — *Bucket-Helper existiert, ohne Wiring (siehe Throttler).*
- [ ] GDPR-Endpoints (`/me/export`, `/me/account`, Anonymisierung)  — *Builder/Erasure-Planner existieren, keine Controller.*
- [ ] Audit-Log-Extension (mit Encryption-Awareness)  — *Service existiert, weder Prisma-Extension verdrahtet noch DI-Provider.*
- [ ] Error-Code-Registry + i18n-Endpoint  — *Registry vorhanden, kein `GET /errors`-Controller.*
- [ ] OpenAPI-Doku komplett (inkl. RFC 7807 Schemas)  — *Hängt komplett von vorhandenen Controllern ab; ohne die kein Spec.*
- [x] CI-Pipeline (`.gitlab-ci.yml`: lint, test, audit, build) — **kein** Container-Build, -Signing oder Deploy auf Template-Ebene
- [x] Test-Containers-Setup für Integration-Tests (Postgres + RustFS)
- [x] Dokumentation für Konsumenten + API-Stability-Promise + Webhook-Spec

---

## 33. Entscheidungen (Ehemals Offene Fragen)

> Stand: 2026-04-28 — Interview-Runde mit Stakeholder. Alle Punkte unten sind getroffene Entscheidungen, nicht mehr offen. Frühere Diskussion ist im git-Verlauf nachvollziehbar.

### 28.1 Runtime & Tooling
1. **Bun in Production:** **Entscheidung: Bun 1.x als primäre Runtime.** Phase 1 mit Bun starten, Fallback-Pfad auf Node 22 dokumentiert halten. Native-Module unter Beobachtung (`bcrypt` → `bcryptjs`, `argon2` → Bun-Native-Bindings prüfen, `sharp` siehe #7).
2. **Bun vs Deno:** **Entscheidung: Bun.** Deno 2 nur als langfristige Backup-Option. Re-Evaluation nur bei nachhaltigem Bun-Pain.
3. **Bun Test vs Vitest:** **Entscheidung: Vitest als Default-Test-Runner.** Größeres Plugin-Ökosystem (Coverage, UI, Snapshots), framework-unabhängig, gute IDE-Integration. Bun-spezifische Performance-Tests dürfen Bun Test gezielt nutzen.

### 28.2 Architektur- und Tool-Entscheidungen
4. **Validation-Library:** **Entscheidung: Zod 4.** Für Schemas, DTO-Validation, OpenAPI-Generation und Frontend-Sharing.
5. **OpenAPI-Bridge:** **Entscheidung: `nestjs-zod` nutzen.** Eskalation zu eigenem Bridge-Layer erst wenn konkrete Limits (z.B. discriminated unions, RFC7807-Mapping) auftreten.
6. **TUS-Bibliothek:** **Entscheidung: `@tus/server` v3 direkt einsetzen.** Bei Bun-/S3-Inkompatibilität in Phase 4: tus-node-server-Fork oder Minimal-Eigenimplementation als Fallback. Frühe Integrationstests verpflichtend.
7. **Image-Transformations:** **Entscheidung: `sharp` als Default.** imgproxy-Sidecar bleibt als dokumentierter Fallback bei Bun-Inkompatibilität oder wenn Asset-Traffic > 100 req/s erreicht (siehe 28.7).
8. **RLS-Komplexität:** **Entscheidung: Prisma-Migrations + Pattern-Bibliothek.** Raw-SQL-Policies in Migrations versionieren; gemeinsame Pattern-Lib für Tenant-Isolation, Soft-Delete und Owner-Check.
9. **Filter-DSL-Sicherheit:** **Entscheidung: Whitelist pro Resource.** Erlaubte Felder + Operatoren explizit deklariert, encrypted Felder grundsätzlich nicht filterbar.
10. **OTel-Backend:** **Entscheidung: Self-hosted Grafana LGTM** (Loki + Tempo + Mimir + Grafana). OTLP-Export bleibt standardisiert, Backend bleibt austauschbar.
11. **Job-Queue-Sichtbarkeit:** **Entscheidung: keine Admin-UI in v1.** Erstmal nur SQL-Snippets/CLI-Tooling dokumentieren. Eigene `/admin/jobs`-Seite kommt nur, wenn Operations sie aktiv einfordert.
12. **MCP-Transport:** **Entscheidung: HTTP+SSE in Production, stdio für Local-Dev. Auth via OAuth.** Reverse-Proxy validiert OAuth-Token (Better-Auth-kompatibel) bevor Request den MCP-Endpoint erreicht.

### 28.3 Encryption & Secrets
13. **KEK-Management:** **Entscheidung: ENV-Var für v1.** Implementierung hinter Driver-Interface (`KekProvider`), damit späterer Wechsel zu Vault/KMS/Doppler ohne Code-Eingriff im Domain-Layer möglich ist.
14. **Searchable-Encryption:** **Entscheidung: Pro Resource konfigurierbar via Schema-Annotation.** Default: nicht filterbar. Code-Review enforced, dass nur hochentropische Felder annotiert werden. Pattern-Beispiele in der Doku.
15. **Re-Encryption nach Key-Rotation:** **Entscheidung: Migration-Status-Tabelle + pg-boss-Job.** Tabelle `key_rotation_runs` mit `progress`, `errors`, `started_at`, `finished_at`. Restart-fähig, sichtbar in Logs/OTel.

### 28.4 Realtime & Search
16. **Socket.IO-Adapter-Strategie:** **Entscheidung: Postgres-NOTIFY-Broadcast.** Jede Instanz lauscht auf NOTIFY und published an eigene Sockets. Redis-Adapter erst bei ~10k concurrent Connections (siehe 28.7).
17. **Search-Index-Sprache:** **Entscheidung: `simple` (sprachneutral) als Default.** Sprachspezifisches Stemming nur on-demand pro Resource, nicht global.
18. **Webhook-Delivery-Fanout:** **Entscheidung: Master-Job pro Event + Sub-Job pro Subscriber.** pg-boss skaliert via Worker-Pool, exakte Retry-/Backoff-Policy pro Endpoint.

### 28.5 Frontend & SDK
19. **Frontend-SDK:** **Entscheidung: kubb.** Plugin-basierte Generation aus OpenAPI 3.1 (TanStack-Query-Hooks, Zod-Schemas, MSW-Mocks).
20. **Realtime-Client-SDK:** **Entscheidung: Socket.IO-Client direkt nutzen.** Channel/Event-Konstanten in `src/shared/contracts/` typisieren und über kubb-SDK mit-publishen. Kein eigenes Wrapper-Package in v1, kann später additiv extrahiert werden.

### 28.6 Migration & Rollout
21. **Migration vom alten Server:** **Entscheidung: Greenfield, keine Daten-Migration.** Neuer Server startet ohne MongoDB-Altdaten. Migrations-Tool bleibt als optionales Sub-Projekt dokumentiert für spätere Use-Cases.

### 28.7 Optionale Features (nur bei konkretem Use-Case)
| Feature | Status v1 | Wann sinnvoll | Werkzeug |
|---|---|---|---|
| **Feature-Flags** | **Eingeplant** | Staged-Rollouts, A/B-Tests, Tenant-spezifische Toggles | Unleash (self-hosted) oder einfache `feature_flags`-Tabelle |
| **Resource-Sharing-Token-Links** | **Eingeplant** | "Geteilte Links" wie Google Drive | Token-Tabelle mit TTL + Permission-Subset, `GET /s/:token` |
| **PgBouncer / Pooler** | Aufgeschoben | Multi-Instance- oder Serverless-Deployment | PgBouncer-Sidecar in Transaction-Mode |
| **imgproxy als Sidecar** | Aufgeschoben | > 100 req/s auf Asset-Endpoints | imgproxy-Container, signed URLs |
| **Search-Engine extern** | Aufgeschoben | > 10M searchable Records, komplexe Faceting | Meilisearch / Typesense (Searchable-Driver tauscht aus) |
| **Secret-Manager** | Aufgeschoben | Compliance-Anforderungen, Multi-Cloud | Doppler, Infisical, HashiCorp Vault |
| **Antivirus-Scan** | Aufgeschoben | User-Uploads von extern | ClamAV-Sidecar, async Scan-Job |
| **Realtime-Adapter Redis** | Aufgeschoben | > 10k concurrent Sockets | `@socket.io/redis-adapter` |

### 28.8 Naming / Format
22. **Error-Code-Prefix:** **Entscheidung: `CORE_*` in Library-/Framework-Code, projektspezifischer Prefix in Apps** (z.B. `APP_*`). Klare Trennung von Quelle und Wiederverwendbarkeit.
23. **`type`-URL bei RFC 7807:** **Entscheidung: Eigene Doku-Domain mit Platzhalter-Fallback.** URL via ENV-Var konfigurierbar (`ERROR_DOC_BASE_URL`), bis Doku-Site live ist Fallback auf `/docs/errors/{code}` im API-Server.

### 28.9 Hosting & Operations (Operativ-Runde)
24. **Hosting-Target:** **Entscheidung: Self-hosted (Hetzner/Bare-Metal).** Eigene VMs/Server, keine Hyperscaler-Bindung. Implikationen:
    - **KEK-Provider** (#13): später HashiCorp Vault (selbst gehostet), nicht AWS-KMS / Cloud-KMS.
    - **Postgres**: selbst betrieben (kein RDS) — Backup-/Replication-Strategie eigenverantwortlich.
    - **Object-Storage**: **RustFS** (S3-API-kompatibel, self-hosted). Keine MinIO-Empfehlung mehr (siehe 28.10/#28).
25. **Repo-Layout:** **Entscheidung: Single-Repo, kein Workspace.** Ein einzelnes `package.json`. Frontend-SDK-Output landet in `./generated/api-client/` und wird als eigenes npm-Paket publiziert (oder als git-submodule konsumiert), nicht als Workspace-Package. `@core/*`-Paketnamen sind aus dem Plan-Text entfernt; gemeinsame Types liegen in `src/shared/`.
26. **CI/CD-Plattform:** **Entscheidung: GitLab CI.** `.gitlab-ci.yml` als Pipeline-Definition. Stages: `lint → test → build → audit`. **Kein Container-Build und kein Deploy auf Template-Ebene** — das Template ist keine deploybare App; konsumierende Projekte bauen ihre eigenen Images (siehe 28.10/#29). Self-hosted GitLab-Runner empfohlen.
27. **Lizenz:** **Entscheidung: MIT.** `LICENSE`-Datei im Repo-Root, `"license": "MIT"` in `package.json`. Kompatibel mit allen Hauptabhängigkeiten (NestJS, Prisma, Better-Auth) und ermöglicht externe Beiträge.

### 28.10 Template-Charakter & Dev-Setup (Operativ-Runde 2)
28. **Object-Storage = RustFS only:** **Entscheidung: ausschließlich RustFS** als Default-S3-Backend. MinIO wird nicht mehr als Alternative empfohlen oder im Plan referenziert. Der `s3`-Storage-Adapter bleibt aber gegen jedes S3-API-kompatible Backend lauffähig (AWS S3, Cloudflare R2, Backblaze B2 …) — Konsumenten mit anderen Anforderungen können das Backend austauschen, der Default-Pfad ist RustFS.
29. **Docker-Scope = nur Projekt-Dependencies:** **Entscheidung: Docker dient ausschließlich der Bereitstellung von Projekt-Dependencies (Postgres, RustFS, Mailpit, OTel-Collector).** Dieses Repo wird **nicht** als deploybares Image gebaut, signiert oder publiziert. Der Server selbst läuft im Dev nativ über `bun --watch`. Production-Container sind Sache der konsumierenden Projekte; das Template liefert nur ein Beispiel-`Dockerfile.example` als Referenz.
30. **Local-Dev-Routing = portless:** **Entscheidung: [vercel-labs/portless](https://github.com/vercel-labs/portless) als Default-Dev-Routing.** Verhindert Port-Kollisionen zwischen mehreren parallel laufenden Server-Instanzen, exponiert jeden Server unter `<service>.<project>.localhost` mit automatischem HTTPS (mkcert). `bun run dev` startet portless implizit (oder bindet sich an einen laufenden portless-Daemon); ohne portless fällt der Server auf einen dynamisch zugewiesenen Port zurück, sodass Devs ohne portless-Setup nicht blockiert sind.
31. **Server-only-Repo:** **Entscheidung: dieses Repo enthält keine Frontend-App.** Einzige browserseitige Oberfläche ist das in Dev/Admin-only zugängliche Dev-/Admin-Panel (Kap. 27). Frontends sind separate Projekte und konsumieren das via kubb generierte API-SDK aus `./generated/api-client/`.
32. **`src/core/` vs `src/modules/`:** **Entscheidung: strikte Trennung.**
    - `src/core/` enthält die Template-Logik (Auth, Permissions, File-Handling, Output-Pipeline, Webhooks-Engine, …). Updates wandern via `bun run sync:from-template` aus dem Template-Repo in Projekte; **lokale Änderungen an `src/core/` müssen per Pull Request zurück ins Template-Repo geführt werden** (`bun run sync:to-template` bereitet das Diff vor). Claude/Devs werden in der Doku angewiesen, Core-Anpassungen explizit als „bitte zurück ins Template" zu markieren.
    - `src/modules/` enthält projekt-spezifische Domain-Module und ist **niemals Teil des Template-Sync** in beide Richtungen.
    - `src/shared/` enthält gemeinsame Types (Channel-Konstanten, Event-Schemas) und wird zusammen mit dem Frontend-SDK publiziert.
    - Das Template darf keine implizite Magic über `src/modules/` ausführen; Projekte sind alleinige Owner ihrer Domain.

---

## 34. Referenzen

- [Better-Auth Docs](https://www.better-auth.com)
- [Directus Permissions Model](https://docs.directus.io/reference/system/permissions.html)
- [Directus Files](https://docs.directus.io/reference/files.html)
- [Postgres RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Prisma Extensions](https://www.prisma.io/docs/orm/prisma-client/client-extensions)
- [TUS Protocol](https://tus.io)
- [RustFS](https://rustfs.com)
- [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0)
- [RFC 7807 — Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc7807)
- [RFC 8594 — Sunset HTTP Header](https://datatracker.ietf.org/doc/html/rfc8594)
- [RFC 9562 — UUID v7](https://datatracker.ietf.org/doc/html/rfc9562)
- [OpenTelemetry Node.js](https://opentelemetry.io/docs/languages/js/)
- [pg-boss](https://github.com/timgit/pg-boss)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [Stripe API Idempotency](https://docs.stripe.com/api/idempotent_requests)
- [Standard Webhooks Spec](https://www.standardwebhooks.com/)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io)
- [PostgREST Filter Operators](https://postgrest.org/en/stable/references/api/tables_views.html#operators)
- [Postgres Full-Text Search](https://www.postgresql.org/docs/current/textsearch.html)
- [Postgres LISTEN/NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)
- [Bun Documentation](https://bun.sh/docs)
- [CASL Documentation](https://casl.js.org)
- [@casl/prisma Bridge](https://casl.js.org/v6/en/package/casl-prisma)
- [@47ng/cloak (Field-Encryption)](https://github.com/47ng/cloak)
- [Socket.IO](https://socket.io/docs/)
- [PowerSync](https://www.powersync.com)
- [PowerSync Sync-Rules](https://docs.powersync.com/usage/sync-rules)
- [PowerSync Self-Hosted](https://docs.powersync.com/self-hosting)
- [PostGIS Documentation](https://postgis.net/documentation/)
- [PostGIS Spatial Reference Systems](https://postgis.net/docs/using_postgis_dbmanagement.html#spatial_ref_sys)
- [GeoJSON Spec (RFC 7946)](https://datatracker.ietf.org/doc/html/rfc7946)
- [Mapbox Geocoding API](https://docs.mapbox.com/api/search/geocoding/)
- [Nominatim (OpenStreetMap)](https://nominatim.org)
- [Scalar API Reference](https://scalar.com)
- [Scalar NestJS Integration](https://github.com/scalar/scalar/tree/main/packages/nestjs-api-reference)
- [NestJS DevTools](https://docs.nestjs.com/devtools/overview)
- [kubb (OpenAPI → TS-Client)](https://kubb.dev)
- [RustFS](https://rustfs.com)

---

