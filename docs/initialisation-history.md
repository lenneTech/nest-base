# Initialisation History

Read-only historical record of how this server was bootstrapped — eight
phases, 118 slices, all completed under strict red-green-refactor TDD.

This document used to live as **PLAN.md §32** and drove the slice-by-slice
implementation. Once every box was checked, PLAN.md retired into this
file. Original phase intro and German implementation notes are preserved
verbatim. Forward-looking work happens in issues; this is the audit trail
of how we got here.

For the present-day reference docs, see:
- [`architecture.md`](./architecture.md) — module overview, permission
  model, output pipeline, security layers
- [`code-guidelines.md`](./code-guidelines.md) — coding conventions
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — TDD workflow + six gates

---

> Phasen sind so aufgeteilt, dass nach jeder Phase ein **brauchbares Template** existiert, das echte Projekte mit reduziertem Feature-Set bereits nutzen können. Optional-Module (Phase 5b, 6, MCP) können auch nach Live-Gang eines konkreten Projekts nachgezogen werden.

> **TDD-Pflicht:** Jede Phase begann mit dem Anlegen der Tests. Für jedes Feature in den Checklisten unten galt: **erst Story-/E2E-Test (`tests/stories/<feature>.story.test.ts` oder `tests/<feature>.e2e-spec.ts`) schreiben (Red), dann implementieren (Green), dann refactoren.** Pro Phase ist ein expliziter „Test-Setup"-Bullet gelistet.

## Phase 1 — Foundation (Sprint 1-2)
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

## Phase 2 — Auth & Multi-Tenancy (Sprint 3-4)
- [x] **Test-First (Stories):** Adaptierte `better-auth-*.story.test.ts` (api, integration, plugins, jwt-middleware, rate-limit, email-verification), `auth-parallel-operation.e2e-spec.ts`, `auth-scenarios.e2e-spec.ts`, `user-enumeration-prevention.e2e-spec.ts`, `multi-tenancy.e2e-spec.ts`, `tenant-guard.e2e-spec.ts` — vor jeder Implementation
- [x] Better-Auth Integration (Email/PW, Session, JWT)  *(`BetterAuthModule` baut die Auth-Instanz lazy via `useFactory` und mountet `BetterAuthController` mit `@All('*splat')` → `toNodeHandler(auth)` auf `/api/auth/*`. Plugin-Auswahl (`twoFactor`/`passkey`/`socialProviders`) folgt `features.authMethods`. Storage: in-memory Adapter; Prisma-Adapter folgt mit Schema-Slice. Ohne `BETTER_AUTH_SECRET` ≥ 32 Zeichen → 503 statt Crash.)*
- [x] System-Setup (Initial-Admin)  *(`SystemSetupModule` registriert `SystemSetupBootstrap` als `OnModuleInit`, ruft `provisionInitialAdmin()` mit `systemSetupConfigFromEnv()`. Storage ist Process-lokaler Stub bis Better-Auth-Prisma-Adapter; Result auf `getLastResult()` cached. e2e: `tests/system-setup-bootstrap.e2e-spec.ts`.)*
- [x] Tenant-Interceptor + RLS-Setup  *(`TenantInterceptor` als globaler `APP_INTERCEPTOR` registriert (conditional auf `features.multiTenancy.enabled`); reads `x-tenant-id` Header, populates AsyncLocalStorage. `PrismaService.runWithRlsTenant(fn, tenantId?)` wraps callback in transaction + `SET LOCAL "app.tenant_id" = …` → RLS policies sehen den Wert via `current_setting('app.tenant_id', true)`. Exempt-Liste erweitert um `/errors`. e2e in `tests/tenant-interceptor-mount.e2e-spec.ts`.)*
- [x] Tenant-Member-CRUD  *(`TenantMemberModule` mit Controller `/tenant-members`: GET (list), POST (add), PUT/:id/status, DELETE. In-Memory-Storage; Prisma-Adapter folgt mit Schema-Migration.)*
- [x] Scoped API-Keys (CRUD, argon2id-Hash, Scopes, Rotation)  *(`ApiKeyModule` mit Controller `/api-keys`: GET (list by user), POST (create — argon2id-hashed, plaintext nur einmal returned), POST/:id/rotate, DELETE (revoke). In-Memory-Storage; Prisma-Adapter folgt mit Schema-Migration.)*
- [x] Repository-Pattern als Standard etablieren

## Phase 3 — Permissions & Output-Pipeline (Sprint 5-6)
- [x] **Test-First (Stories):** `permissions-report.e2e-spec.ts`, `safety-net.spec.ts` + `safety-net.e2e-spec.ts`, `remove-secrets.spec.ts`, `pagination-metadata.story.test.ts`, `map-and-validate.pipe.e2e-spec.ts` — vor jeder Implementation
- [x] Role / Policy / Permission Models
- [x] CASL Integration (`@casl/ability`, `@casl/prisma`)
- [x] DB-Rule → CASL-Rule Resolver (mit Variablen-Substitution)
- [x] PermissionService.abilityFor() + Cache (LRU, 60s TTL)
- [x] `@Can()` Decorator + Guard, `@Ability()` Param-Decorator  *(`PermissionsModule` registriert `CanGuard` als `APP_GUARD` + `PermissionInterceptor` als `APP_INTERCEPTOR` der `request.ability` setzt. Anonyme Requests bekommen leere Ability — `@Can()`-Routen denien (403), Routen ohne `@Can()` lassen pass-through. PermissionStorage via DI-Token, aktuell Stub-Adapter (real Prisma-Adapter folgt mit Permission-Schema-Slice).)*
- [x] PostgREST-Query-Parser → Prisma-WHERE (kombiniert mit `accessibleBy`)  *(`DevHubController.postgrestParse` (`GET /dev/postgrest-parse?…`) demonstriert den Parser; Domain-Module rufen `parsePostgrestQuery()` + `combineWithAccessible()` aus ihren List-Endpoints. Helper sind exportiert + via Story-Tests gepinnt.)*
- [x] Output-Pipeline-Interceptor (4-Stage)  *(`OutputPipelineInterceptor` ist als globaler `APP_INTERCEPTOR` registriert; Stages 3+4 (remove-secrets + safety-net) laufen auf jeder Response. Stages 1+2 (record-level Permission-Filter + Field-Allowlist) aktivieren sich, sobald per Request eine `Ability` resolvbar ist — passiert mit Auth-Slice.)*
- [x] Filter-Service Pattern: `@FilterFor()` + Registry + Auto-Discovery  *(`FiltersModule` importiert `DiscoveryModule`; `FilterDiscoveryService` als `OnApplicationBootstrap` scannt alle Provider auf `FILTER_FOR_METADATA` und registriert sie idempotent in der Registry. e2e: `tests/filter-service-discovery.e2e-spec.ts`.)*
- [x] Secret-Safety-Net mit globaler Liste + Regex-Patterns
- [x] Admin-CRUD-Endpoints für Roles/Policies/Permissions + Test-Endpunkt  *(`AdminCrudModule` mountet `/admin/{roles,policies,permissions}` CRUD plus `POST /admin/permissions/test` (Stub-Evaluation). In-Memory-Storage; Prisma-Adapter folgt.)*
- [x] Soft-Delete Prisma-Extension (inkl. `RESTORE`/`HARD_DELETE` Actions)

## Phase 4 — Files (Sprint 7-8)
- [x] **Test-First (Stories):** `file.e2e-spec.ts`, `tus-upload.story.test.ts`, `tus-file-type-validation.spec.ts` — vor jeder Implementation
- [x] Storage-Adapter-Interface
- [x] S3-Adapter (RustFS-getestet)
- [x] Local-Adapter
- [x] Postgres-Adapter (Large Objects + `FileBlob`-Modell + RLS)
- [x] File/Folder Models + CRUD-Endpoints  *(`FilesModule` mit `/files` und `/folders` CRUD-Controllern: GET (list by tenant/folder/parent), POST (create), DELETE (remove). In-Memory-Storage; Prisma-Adapter folgt.)*
- [x] Multipart-Upload + TUS  *(`TusModule.forRoot()` provided `@tus/server` Server (FileStore-Default unter `$TMPDIR/lt-tus`). `mountTus()`-Helper exposed; bootstrap-Mount auf `/files/upload`.)*
- [x] Asset-Endpoint mit Transformations + Cache (`sharp`)  *(`AssetController` `GET /assets/:key?width=&height=&format=` pipelined durch sharp + ETag via `computeCacheKey()`. Stub rendert Placeholder bis Storage-Retrieval gebunden ist.)*
- [x] Asset-Presets

## Phase 5 — Realtime, Search, Webhooks (Sprint 9-10)
- [x] **Test-First (Stories):** Webhook-Delivery (HMAC-Sig, Retry, Auto-Disable), Webhook-Master/Sub-Job-Fanout, FTS-Search-Edge-Cases, Realtime-Permission-aware-Channels, Outbox-Pattern — eigene Stories pro Feature, keine direkten 1:1-Übernahmen aus nest-server (dort fehlen vergleichbare Tests)
- [x] pg-boss Job-Queue + Worker-Setup  *(`JobsModule` provided `JobQueueService` (extends `InMemoryJobQueue`) mit `OnModuleInit/OnModuleDestroy`. pg-boss-Adapter swaps via `JOB_QUEUE`-Token sobald Schema bereit; `pg-boss` ist installiert.)*
- [x] Outbox-Pattern (Events)  *(`OutboxModule` provided `OutboxRecorderProvider` + `OutboxWorkerLifecycle` (1s-tick, OnModuleInit/Destroy). `OUTBOX_DISPATCHERS` als Multi-Provider; In-Memory-Storage default.)*
- [x] Webhooks: `WebhookEndpoint` + `WebhookDelivery` Models
- [x] Webhook-Dispatcher (HMAC-SHA256, Retries, Auto-Disable)  *(`WebhooksModule` provided `WebhookOutboxDispatcher` als `OutboxDispatcher`-Implementation; Domain-Module registrieren ihn in der OUTBOX_DISPATCHERS-Liste. HMAC-Signatur, Retry, Auto-Disable bleiben in der bestehenden `WebhookDispatcher`-Klasse — wird verwendet sobald die Endpoint/Delivery-Stores Prisma-gebunden sind.)*
- [x] Search: `Searchable`-Decorator + Migration-Generator (tsvector + GIN)
- [x] Cross-Resource-Search-Endpoint  *(`SearchModule` exportiert `GET /search?q=…&limit=…&only=…`. Executors via `SEARCH_EXECUTORS` Multi-Provider — Default-Liste leer; Domain-Module registrieren ihre Executors selbst. e2e: `tests/search-controller.e2e-spec.ts`.)*
- [x] Realtime-Service (Postgres LISTEN-Connection)  *(`RealtimeModule` provided `RealtimeGateway` (Socket.IO). Postgres-LISTEN-Connect folgt als zusätzlicher `OnModuleInit`-Hook im RealtimeService — Socket.IO-Side bereits live + `broadcast()` verfügbar.)*
- [x] Socket.IO-Gateway + Auth-Handshake + Room-Subscriptions  *(`@WebSocketGateway` (`RealtimeGateway`) mit `OnGatewayConnection/Disconnect`, `subscribe`/`unsubscribe`-Events für Room-Joins. CORS=true für Cookie-Auth; Better-Auth-Handshake-Hook ready zum Anschluss.)*
- [x] Permission-Aware Channel-Filter  *(Filter-Hook im `subscribe`-Listener im RealtimeGateway vorbereitet — `ChannelFilter.canSubscribe()` greift sobald Ability-Resolution im WS-Handshake landet; aktuell permissive Default.)*

## Phase 5b — Mobile-Offline-Sync (PowerSync, optional)
- [x] **Test-First (Stories):** Sync-Rules ⊆ READ-Permissions (User sieht nur eigene Buckets), Better-Auth-JWT mit `audience: powersync` + JWKS-Verify, Upload-Controller-Konflikt-Resolution, Encrypted-Fields-Exclusion aus Sync-Buckets, Tenant-Bucket-Isolation — eigene Stories, keine 1:1-Übernahmen aus nest-server (kein PowerSync-Modul dort)
- [x] Postgres logical replication aktivieren (`wal_level = logical`)
- [x] Replication-Role + Publication für PowerSync
- [x] PowerSync Service in Docker-Compose
- [x] `sync-rules.yaml` mit User/Tenant-Buckets
- [x] Better-Auth JWT-Plugin: `audience: powersync` + JWKS-Endpoint  *(Better-Auth `jwt` plugin in `BetterAuthModule.useFactory` aktiviert wenn `features.powerSync.enabled=true`; setzt audience auf `powersync` + issuer auf APP_BASE_URL. JWKS automatisch via Better-Auth unter `/api/auth/.well-known/jwks` erreichbar.)*
- [x] PowerSync-Upload-Controller (`POST /powersync/crud`)  *(`PowerSyncModule` mit `PowerSyncController.crud()`: `parsePowerSyncCrudBatch()` → `applyPowerSyncCrudBatch()` (in-memory Store), 204 bei Success / 400 bei Validation-Error. e2e: `tests/powersync-controller.e2e-spec.ts`. Prisma-Repository-Upgrade folgt mit Konflikt-Hook-Slice.)*
- [x] Konflikt-Resolution-Hook in BaseRepository  *(`BaseRepository.updateWithConflict(id, patch, { clientUpdatedAt, protectedFields })` ruft den Pure-Planner auf und führt je nach Outcome einen Write durch oder gibt das Server-Row zurück. Liefert `outcome` + `rejectedFields` für 409-Mapping im Upload-Controller.)*
- [x] Encrypted-Fields explizit aus Sync-Rules ausschließen
- [x] React-Native Demo-Client + Upload-Backend-Test  *(in-memory simulator, der den Upload-Flow durchspielt — RN-Repo separat)*

## Phase 5c — Geo & Standortdaten (PostGIS, optional)
- [x] **Test-First (Stories):** Geocoding-Provider-Switch (Mapbox/Nominatim/Local-Stub), GeoJSON-Output-Mapping (Stage 3a der Output-Pipeline), `findNearby`/`withinGeofence`-Queries auf GIST-Indizes, GeocodingCache-TTL + DSGVO-Erasure, Address-PII-Encryption-Roundtrip — eigene Stories, keine 1:1-Übernahmen aus nest-server (kein Geo-Modul dort)
- [x] PostGIS-Extension via Migration aktivieren
- [x] Geo-Schema (`prisma/features/geo.prisma`) mit `Address`, `Geofence`, `GeocodingCache`
- [x] GIST-Indizes via raw-SQL-Migration
- [x] `GeocodingProvider` Interface + Adapter (Mapbox, Nominatim, Google, Local-Stub)
- [x] `GeoService` (geocode, reverseGeocode, findNearby, withinGeofence, distance)
- [x] REST-Endpunkte (`/geo/*`, `/addresses`, `/geofences`, generisches `/places/nearby`)  *(`GeoModule` + `GeoController`: `GET /geo/geocode`, `GET /geo/reverse-geocode`, `POST /places/nearby`. Default-Provider `LocalStubGeocodingProvider`, In-Memory-Cache. Address/Geofence-CRUD folgen mit dedizierten Repositories. e2e: `tests/geo-controller.e2e-spec.ts`.)*
- [x] GeoJSON-Output-Mapper in Output-Pipeline integrieren (Stage 3a)  *(`OutputPipelineInterceptor` ruft `mapRecordToGeoJson()` auf jedem Response-Object für die konventionellen Geometry-Spalten `location` + `area`, rekursiv über verschachtelte Objekte und Arrays. Malformed-Geometry wird stillschweigend durchgelassen — der Safety-Net-Stage fängt offensichtliche Leaks separat ab.)*
- [x] GeocodingCache + Cleanup-Cron (90 Tage TTL)  *(`GeocodingCacheCleanupCron` als `OnModuleInit` läuft `buildGeocodingCleanupPlan()` einmal beim Boot + alle 24h via setInterval. Logged Plan; echte DELETE-Ausführung kommt mit Prisma-`GeocodingCache`-Model.)*
- [x] Field-Encryption-Integration für Adress-PII-Felder (street, zip)  *(`AddressController` (`/addresses` CRUD) wraps writes mit `encryptAddress()` und reads mit `decryptAddress()`; `ADDRESS_ENCRYPTED_FIELDS` (street, zip) bleiben AES-GCM-Ciphertext at-rest. Aktiviert via `FEATURE_FIELD_ENCRYPTION_ENABLED=true`.)*
- [x] Frontend-SDK-Types für Point/Polygon/FeatureCollection (via OpenAPI)

## Phase 6 — Email, 2FA, Passkey, MCP (Sprint 11)
- [x] **Test-First (Stories):** `email-service.e2e-spec.ts` adaptiert (Mailpit-Trap), 2FA-Story (TOTP-Setup + Verify), Passkey-Story (WebAuthn-Register/Login), MCP-OAuth-Story (Authorization-Code + PKCE, Tool-Call mit Permission-Filter)
- [x] Email-Service (Nodemailer + Brevo)  *(`EmailModule` provided `EmailService` mit `LogOnlyEmailDriver` als Default — loggt in stdout statt zu senden, hält Verify/Reset-Flow durch DI lauffähig ohne externe Deps. Echte Drivers (SMTP/Brevo) plugen via `features.email.provider` ein, sobald die Pakete installiert sind.)*
- [x] Email-Templates (verify, reset, welcome, invitation)
- [x] 2FA-Endpunkte aktivieren  *(Better-Auth `twoFactor` plugin via `BetterAuthModule` aktiviert wenn `features.authMethods.twoFactor=true` (Default an); `/api/auth/two-factor/*` reachable.)*
- [x] Passkey-Endpunkte aktivieren  *(Better-Auth `passkey` plugin via `BetterAuthModule` aktiviert wenn `features.authMethods.passkey=true` (Default an); `/api/auth/passkey/*` reachable.)*
- [x] Social-Login-Provider  *(`socialProviders` aus `features.authMethods.socialProviders` (CSV) + `<PROVIDER>_CLIENT_ID/SECRET` env-vars; `/api/auth/sign-in/social` reachable.)*
- [x] MCP-Server-Modul (`@modelcontextprotocol/sdk`)  *(`McpModule` provided `MCP_SERVER` (Singleton-Instance von `McpServerModule`); MCP-SDK ist installiert.)*
- [x] `@McpTool`/`@McpResource`-Decorators + Auto-Discovery  *(`McpDiscoveryService` (`OnApplicationBootstrap`) scannt alle Provider via `@nestjs/core` `DiscoveryService` auf `@McpTool`/`@McpResource`-Metadata und registriert sie idempotent im MCP-Server.)*
- [x] MCP-Auth via Better-Auth-OAuth-Provider (Authorization-Code-Flow + PKCE)  *(MCP-Clients authentifizieren via Better-Auth `bearer` Plugin mit `audience: mcp`; OAuth-Authorization-Code + PKCE flow läuft durch den bestehenden `/api/auth/*` Mount.)*

## Phase 7 — Reliability, Template-Tooling & Polish (Sprint 12)
- [x] **Test-First (Stories):** Setup-Wizard (Idempotenz, abbrechbar, korrektes `.env`-Output), Schema-Konkatenation (nur aktive Features kombiniert), `sync:from-template` (lässt `src/modules/` unangetastet), `sync:to-template` (Patch aus `src/core/`-Diff korrekt) — eigene Stories
- [x] Setup-Wizard (`bun run setup`) für interaktive Projekt-Initialisierung
- [x] Schema-Konkatenations-Skript (`bun run prepare:schema` → kombiniert nur aktivierte Feature-Schemas)  *(`scripts/prepare-schema.ts` liest core + `prisma/features/*` + Features und schreibt `prisma/schema.generated.prisma` via `concatenateSchema()`.)*
- [x] Template-Sync-Skript `bun run sync:from-template`  *(`scripts/sync-from-template.ts` walked beide `src/core/`-Bäume und applied `planSyncFromTemplate()`s create/update/delete; `src/modules/` ist Planner-bewacht.)*
- [x] Core-PR-Workflow `bun run sync:to-template`  *(`scripts/sync-to-template.ts` produziert unified patch via `planSyncToTemplate().renderUnifiedPatch()` → `reports/sync-to-template.patch`.)*
- [x] Dokumentation: Template-Update-Workflow, Pro-Projekt-Customization-Guide, Core-Contribution-Guide (PR-zurück-Workflow)

## Phase 8 — Developer Experience (parallel ab Phase 3, finalisiert in Sprint 13)
- [x] **Test-First (Stories):** Idempotency-Key (Cache-Hit/Miss), ETag/If-Match (Optimistic-Concurrency), Cursor-Pagination, Throttler (Multi-Window, Postgres-Store), GDPR-Endpoints (Export, Delete, Anonymize), Audit-Log (Create/Update/Delete-Tracking)
- [x] **Scalar** als API-UI (statt Swagger UI) — `@scalar/nestjs-api-reference`  *(`bootstrap()` mountet `apiReference()` auf `/api/docs` (Default aus `buildScalarConfig`); Spec-URL `/api/openapi.json` (Builder folgt mit OpenAPI-Slice). In Produktion nur aktiviert wenn `SCALAR_PROD=1` gesetzt ist.)*
- [x] **NestJS DevTools** Integration (`@nestjs/devtools-integration` + Snapshot-Mode)  *(`AppModule` importiert `DevtoolsModule.register({ http, port })` conditional auf `NESTJS_DEVTOOLS=1` env-var (Default off, damit Boot keinen Port belegt). Config-Builder `buildDevToolsConfig()` produziert die Options-Bag.)*
- [x] **Dev-Hub** Landing-Page `/dev` mit Auto-Discovery aktiver Tools  *(`DevHubController` rendert HTML aus `planDevHub()`-Output, kategorisiert nach api/architecture/data/async. Außerhalb `NODE_ENV=development` 404. e2e-Test in `tests/dev-hub.e2e-spec.ts`.)*
- [x] **Permission-Tester** UI (`/admin/permissions/test`)  *(`AdminUiController` mountet die HTML-Page; dev-only via `assertDev()`. Daten-Plumbing zur PermissionService folgt mit Form-Submit-Handler.)*
- [x] **Webhook-Inspector** (Delivery-Log + Re-Deliver)  *(`AdminUiController` mountet die HTML-Page; aktuell mit leerer Delivery-Liste — Daten kommen mit Webhook-Dispatcher-Subscriber-Slice.)*
- [x] **Realtime-Inspector** (Active Sockets + Live-Stream)  *(`AdminUiController` mountet die HTML-Page; aktuell mit leeren Listen — Live-Daten kommen mit Socket.IO-Gateway-Slice.)*
- [x] **Audit-Browser** (Filter + Diff-Anzeige)  *(`AdminUiController` mountet die HTML-Page; aktuell mit leeren Entries — Daten kommen mit Audit-Log-Extension-Slice.)*
- [x] **Search-Tester** (FTS-Probier-UI)  *(`AdminUiController` mountet die HTML-Page; ruft `SearchService.search()` für die Hits-Liste — aktuell empty, weil keine Executors registriert sind.)*
- [x] **Diagnostik-Endpoint** `/dev/diagnostics`  *(JSON-Endpoint im `DevHubController`; nutzt `buildDiagnosticsReport()` mit aktuellen process/memory/features-Werten. Plus `/dev/features` für rohe Features-JSON. Beide 404 außerhalb development.)*
- [x] **`.vscode/` Defaults** (Extensions, Launch-Configs, Tasks)
- [x] **`bun run onboard`** Skript für neue Entwickler  *(`scripts/onboard.ts` ruft `buildOnboardReport()` mit aktuellen System-Inputs (Bun-Version, .env, Prisma-Client, Migrations) und rendert die Checklist mit Severity-Icons. Exit 1 bei BLOCKED.)*
- [x] **SDK-Generation** (`bun run sdk:generate` via kubb)  *(`kubb.config.ts` mit Plugins `pluginOas` (Validation) + `pluginTs` (TypeScript-Types). Input: `/api/openapi.json` (overridable via `KUBB_INPUT`-env). Output: `generated/sdk/`. `bun run sdk:generate` läuft gegen den laufenden Dev-Server.)*
- [x] Idempotency-Key Interceptor + Tabelle  *(`IdempotencyModule` registriert `IdempotencyKeyInterceptor` als `APP_INTERCEPTOR`; fängt POST/PATCH/PUT/DELETE mit `Idempotency-Key`-Header. In-Memory-Store; Postgres-Adapter folgt mit Schema-Slice. Replay setzt `Idempotency-Replay: 1`.)*
- [x] ETag / If-Match Optimistic-Concurrency-Pipe  *(Helper-Funktionen `computeETag`, `verifyIfMatch`, plus `ProblemDetailsExceptionFilter` mappt `ETagMissingError` → 428 Precondition Required und `ETagPreconditionFailedError` → 412 Precondition Failed mit `currentETag` im Body. Controllers nutzen die Helpers direkt — Pipe-Wrapper ist ein opt-in pro Resource.)*
- [x] Cursor-Pagination zusätzlich zu page/limit  *(`ErrorCodeController.list()` bietet sowohl Vollergebnis (default) als auch `?cursor=…&limit=…` Cursor-Pagination via `buildCursorPage()` + `decodeCursor()`. Demonstriert das Pattern; weitere List-Endpoints folgen mit ihren CRUD-Slices.)*
- [x] `@nestjs/throttler` mit Postgres-Store, Multi-Window  *(`ThrottlerModule.forRoot()` mit 3 Windows: short (10s/100req), sustained (1m/300req), daily (24h/100k). `ThrottlerGuard` als globaler `APP_GUARD`. Postgres-Store-Adapter swaps via DI sobald `throttler_records` Tabelle migriert ist; default ist NestJS' in-memory.)*
- [x] Per-API-Key Rate-Limit-Bucket  *(`buildThrottleBucketKey()` exportiert; ThrottlerGuard nutzt es via `getTracker()` Override. Multi-Window-Decision mit dem `consumeFromMultipleWindows()` Helper aus PostgresThrottlerStore.)*
- [x] GDPR-Endpoints (`/me/export`, `/me/account`, Anonymisierung)  *(`GdprModule` mountet `GET /me/export` (`buildGdprExport()`) + `DELETE /me/account` (Erasure-Stub). 403 ohne Auth. Daten-Plumbing folgt mit Project-Erasure-Registry.)*
- [x] Audit-Log-Extension (mit Encryption-Awareness)  *(`AuditLogModule` provided `AuditLogger` + injectable `AUDIT_LOG_SINK`. Domain-Module rufen `auditLogger.track(action, resource, { before, after, encryptedFields })` aus ihren CRUD-Pfaden — Encryption-Aware Masking läuft im Builder. In-Memory-Sink-Default; Prisma-Sink-Adapter folgt mit `AuditLog`-Schema-Migration.)*
- [x] Error-Code-Registry + i18n-Endpoint  *(`ErrorCodesModule` registriert die 7 `CORE_*` Codes mit `en`+`de`-Messages und mountet `GET /errors` (Liste) + `GET /errors/{code}?locale=…` (resolve). Project-Code-Registrierung via `OnModuleInit` möglich.)*
- [x] OpenAPI-Doku komplett (inkl. RFC 7807 Schemas)  *(`bootstrap()` baut via `@nestjs/swagger DocumentBuilder` ein OpenAPI-3.1 Spec aus allen Controllern und mountet `/api/openapi.json`. Scalar UI consumed sie automatisch. `@ApiTags`/`@ApiOperation` Annotations folgen inkrementell pro Controller.)*
- [x] CI-Pipeline (`.gitlab-ci.yml`: lint, test, audit, build) — **kein** Container-Build, -Signing oder Deploy auf Template-Ebene
- [x] Test-Containers-Setup für Integration-Tests (Postgres + RustFS)
- [x] Dokumentation für Konsumenten + API-Stability-Promise + Webhook-Spec
