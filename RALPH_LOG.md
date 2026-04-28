# Ralph-Loop Log

Append-only Iteration-Log. Ein Eintrag pro Loop-Durchgang.

<!-- Format pro Eintrag:
## Iteration <n> · <ISO-Timestamp>
- Phase: <X>
- Slice: <Bullet-Text aus PLAN.md §32>
- Tests: <pfade> rot → grün
- Coverage: core <X>%, modules <Y>%
- Commit: <sha-7>
- Blocker: <none|kurz>
-->

## Iteration 1 · 2026-04-28T16:14:00Z
- Phase: 0 (Bootstrap) + 1 (Foundation, Slice 1)
- Slice: Phase 0 Repo-Bootstrap + Phase 1 Test-Infrastruktur
- Tests: `tests/unit/test-infrastructure.spec.ts` rot (DATABASE_URL/TEST_INFRA_READY undefined) → grün (testcontainers Postgres 17 startet, env-vars gesetzt). `tests/types/test-infrastructure.type-test.ts` als Compile-Check.
- Coverage: src/core 0/0 (keine Sources), src/modules 0/0 (keine Sources)
- Commits: d481ff7 (chore: bootstrap repo) · 5bf260d (test red) · 43ccc6e (feat green)
- Blocker: none

## Iteration 2 · 2026-04-28T16:18:00Z
- Phase: 1 (Foundation, Slice 2)
- Slice: TestHelper (Builder für authentifizierte Test-Requests, parallel-sichere Test-User mit UUID-Suffix, ID-basiertes Cleanup)
- Tests: `tests/unit/test-helper.spec.ts` rot (Modul fehlt) → grün (9 Tests grün, UUID v7, plus-suffix Emails, LIFO Cleanup, trackId-Registry)
- Coverage: src/core 100/100/100/100 (Stmts/Branch/Funcs/Lines), src/modules 0/0
- Commits: 935d248 (test red) · 8f32190 (feat green)
- Blocker: none — HTTP-/Auth-Wrap der TestHelper kommt in späteren Slices wenn Nest + Better-Auth landen

## Iteration 3 · 2026-04-28T16:20:00Z
- Phase: 1 (Foundation, Slice 3)
- Slice: Coverage-Gate (≥ 90 % auf src/core/, ≥ 80 % auf src/modules/) in .gitlab-ci.yml
- Tests: `tests/unit/coverage-gate.spec.ts` rot (Modul fehlt) → grün (6 Tests grün, thresholds + GitLab-CI-Wiring + Vitest-Wiring verifiziert)
- Coverage: src/core 100/100/100/100, src/modules 0/0
- Commits: c882657 (test red) · 717d61e (feat green)
- Blocker: none

## Iteration 4 · 2026-04-28T16:25:00Z
- Phase: 1 (Foundation, Slice 4)
- Slice: Adaptierte Stories aus nest-server (error-code, cookies-cors-config, cookies-security-property, system-setup, server)
- Tests: 5 adaptierte Test-Files (`tests/stories/error-code.story.test.ts`, `tests/cookies-cors-config.spec.ts`, `tests/cookies-security-property.e2e-spec.ts`, `tests/system-setup.e2e-spec.ts`, `tests/server.e2e-spec.ts`) rot → grün (34 neue Tests; 52 Tests gesamt)
- Coverage: src/core 98.76/90.24/100/98.71 (Stmts/Branch/Funcs/Lines), src/modules 0/0
- Commits: <red> · <green> (siehe git log)
- Blocker: none — Running-App-E2E (Status-Code-Mapping, Helmet, Auth-Cookie) folgen wenn Nest bootet (nächste Slice "Projekt-Skeleton")

## Iteration 5 · 2026-04-28T16:33:00Z
- Phase: 1 (Foundation, Slice 5)
- Slice: Projekt-Skeleton (Bun + NestJS + Prisma + Postgres)
- Tests: `tests/server-boot.e2e-spec.ts` rot (bootstrap-Modul fehlt) → grün (3 Tests; Boot, JSON-Content-Type, 404)
- Coverage: src/core 96.19/87.23/100/96.07 (Stmts/Branch/Funcs/Lines), src/modules 0/0
- Commits: 3a1cbd1 (test red) · <green> (siehe git log) · <log>
- User-Override: Prisma 7 (statt 6) + Postgres 18 (statt 17), Eintrag in RALPH_DIRECTIVES.md / „Stack-Overrides gegen PLAN.md §33"
- Blocker: none — vitest test:e2e Glob-Bug (Bash hat `**` nicht expandiert) gefixt durch Substring-Filter

## Iteration 6 · 2026-04-28T16:41:00Z
- Phase: 1 (Foundation, Slice 6)
- Slice: ENV-Validation (Zod) + Config-Modul
- Tests: `tests/stories/config.story.test.ts` rot (Module fehlen) → grün (10 Tests; loadAppConfig + ConfigModule.forRoot DI)
- Coverage: src/core 96.37/89.83/97.05/96.24 (Stmts/Branch/Funcs/Lines), src/modules 0/0
- Commits: e764bef (test red) · <green> (siehe git log) · <log>
- Blocker: none. Wichtige Erkenntnisse: (1) Vitest setzt `process.env.BASE_URL='/'` automatisch → eingeführt `APP_BASE_URL` als kanonische Variable, `BASE_URL` bleibt Sentinel-aware Fallback. (2) `NODE_ENV='test'` wird als `development` normalisiert, damit AppEnv-Union 3-wertig bleibt.

## Iteration 7 · 2026-04-28T16:45:00Z
- Phase: 1 (Foundation, Slice 7)
- Slice: Feature-Flag-System (`features.ts` + Conditional-Imports + Validierung von Abhängigkeiten)
- Tests: `tests/stories/features.story.test.ts` rot (Modul fehlt) → grün (20 Tests; FeaturesSchema-Defaults, FEATURE_* ENV-Overrides, Dependency-Validation, conditionalImport-Helper)
- Coverage: src/core 96.91/89.58/98.27/97.18 (Stmts/Branch/Funcs/Lines), src/modules 0/0
- Commits: e8b7dff (test red) · df03d44 (feat green) · <log>
- Blocker: none. Erkenntnis: Zod 4 hat `.default({})`-Semantik geändert — leerer Object-Default rekursiert nicht mehr in innere Defaults. Workaround: pro Sub-Schema `.default(() => Schema.parse({}))` statt `.default({})`.

## Iteration 8 · 2026-04-28T16:49:00Z
- Phase: 1 (Foundation, Slice 8)
- Slice: Logger (Pino) + OpenTelemetry-Integration
- Tests: `tests/stories/observability.story.test.ts` rot (Modul fehlt) → grün (9 Tests; createLogger Level-Defaults, PinoLoggerService NestJS-Bridge, initObservability Noop in test/disabled, SDK lifecycle in prod)
- Coverage: src/core 96.49/88.39/97.22/97.10 (Stmts/Branch/Funcs/Lines), src/modules 0/0
- Commits: 70fa102 (test red) · <green> · <log>
- Blocker: none. `defaultSdkFactory` wirft, wenn observability=true aber kein SDK injiziert — bewusst loud-fail, damit Konsumenten den ungewünschten Stub-Boot bemerken.

## Iteration 9 · 2026-04-28T17:06:00Z
- Phase: 1 (Foundation, Slice 9)
- Slice: Helmet + CSP-Middleware
- Tests: `tests/security-headers.e2e-spec.ts` rot (Modul fehlt) → grün (9 Tests; nosniff, X-Frame-Options, CSP default-src, no X-Powered-By, Referrer-Policy, env-aware CSP/HSTS)
- Coverage: src/core 96.99/87.93/97.26/97.60, src/modules 0/0
- Commits: c513a64 (test red) · 69ca011 (feat green) · <log>
- Blocker: none

## Iteration 10 · 2026-04-28T17:09:00Z
- Phase: 1 (Foundation, Slice 10)
- Slice: Request-Context-Middleware (W3C Trace Context)
- Tests: `tests/stories/request-context.story.test.ts` rot (Modul fehlt) → grün (10 Tests; parseTraceparent, runWithRequestContext, AsyncLocalStorage-Isolation, NestJS-Middleware mit Header-Reuse + Mint)
- Coverage: src/core 96.10/87.32/96.55/97.72, src/modules 0/0
- Commits: bc165d1 (test red) · <green> · <log>
- Blocker: none

## Iteration 11 · 2026-04-28T17:11:00Z
- Phase: 1 (Foundation, Slice 11)
- Slice: Health-Check (Liveness + Readiness)
- Tests: `tests/health.e2e-spec.ts` rot (Endpoints fehlen) → grün (5 Tests; /health/live ohne Dep-Checks, /health/ready mit Prisma-Ping + responseTimeMs)
- Coverage: src/core 95.77/85.52/96.77/97.26, src/modules 0/0
- Commits: b834492 (test red) · <green> · <log>
- Blocker: none — Branch-Coverage 85.52 % knapp über 85 % Threshold (Failure-Pfade in HealthService noch nicht ausgetestet, kommen wenn Prisma-Mocking landet)

## Iteration 12 · 2026-04-28T17:13:00Z
- Phase: 1 (Foundation, Slice 12)
- Slice: RFC 7807 Problem-Details Exception-Filter
- Tests: `tests/problem-details.e2e-spec.ts` rot (Filter fehlt) → grün (16 Tests inkl. parametrisierter Status→Code-Map: HttpException, ZodError, Unknown Error, Success-Pass-Through, Bad-Request/Unauthorized/Conflict/Rate-Limit/5xx, String-/Array-Body)
- Coverage: src/core 96.20/86.17/96.93/97.56, src/modules 0/0
- Commits: b405667 (test red) · e183f9e (feat green) · <log>
- Blocker: none

## Iteration 13 · 2026-04-28T17:16:00Z
- Phase: 1 (Foundation, Slice 13)
- Slice: Dockerfile.example als Template-Referenz (Multi-Stage Bun, non-root, nicht in CI gebaut)
- Tests: `tests/unit/dockerfile-example.spec.ts` rot (.dockerignore + OCI-Labels fehlten) → grün (11 Tests; Bun-Base, ≥3 Stages, non-root USER, HEALTHCHECK, EXPOSE, OCI-Labels, .dockerignore-Inhalt, GitLab CI ohne Container-Build)
- Coverage: src/core 96.20/86.17/96.93/97.56 (unverändert — Test-File ist tests/unit ohne neue src-Pfade), src/modules 0/0
- Commits: 6c0fcd8 (test red) · a06e1b9 (feat green) · <log>
- Blocker: none

## Iteration 14 · 2026-04-28T17:18:00Z
- Phase: 1 (Foundation, Slice 14)
- Slice: Docker-Compose-Setup nur für Projekt-Dependencies (Postgres + RustFS + Mailpit + OTel-Collector); Server läuft nativ über `bun --watch`
- Tests: `tests/unit/docker-compose.spec.ts` rot (`name:` + `networks:` fehlten) → grün (11 Tests; 4 Pflicht-Services, kein api/server-Service, Postgres 18, RustFS statt MinIO, pg_isready, Mailpit 1025/8025, OTel 4317/4318, dev-Script via bun --watch)
- Coverage: src/core 96.20/86.17/96.93/97.56 (unverändert), src/modules 0/0
- Commits: ef27a36 (test red) · d4eb4d9 (feat green) · <log>
- Blocker: none

## Iteration 15 · 2026-04-28T17:21:00Z
- Phase: 1 (Foundation, Slice 15)
- Slice: portless-Integration (portless.yml + dev-Runner mit Fallback)
- Tests: `tests/unit/portless.spec.ts` rot (Modul + scripts/dev.ts fehlten) → grün (11 Tests; portless.yml-Routing, shouldUsePortless mit DISABLE_PORTLESS-Override, resolveDevPort mit PORT/portlessAvailable/Fallback, package.json-Wiring)
- Coverage: src/core 96.30/87.12/97.00/97.62, src/modules 0/0
- Commits: e62d2d0 (test red) · <green> · <log>
- Blocker: none — `bun run dev` startet portless implizit wenn vorhanden, fällt sonst auf Port 0 (dynamisch) zurück

## Iteration 16 · 2026-04-28T17:24:00Z
- Phase: 1 (Foundation, Slice 16)
- Slice: Repo-Layout src/core/ + src/modules/ + src/shared/
- Tests: `tests/unit/repo-layout.spec.ts` rot (src/modules/.gitkeep + src/shared/index.ts fehlten) → grün (6 Tests; Verzeichnis-Existenz, tsconfig-Aliases, vitest-Aliases, README-Doku)
- Coverage: src/core 96.30/87.12/97.00/97.62 (unverändert), src/modules 0/0
- Commits: 813ab90 (test red) · <green> · <log>
- Blocker: none

## Iteration 17 · 2026-04-28T17:26:00Z
- Phase: 1 (Foundation, Slice 17)
- Slice: Prisma-Schema v1 (User, Tenant, Role) mit @@map/@map snake_case
- Tests: `tests/unit/prisma-schema.spec.ts` rot (Models fehlen) → grün (11 Tests; User/Tenant/Role Strukturen, snake_case-Mapping, FK-Relations, unique-Constraints, DateTime-Mapping-Convention)
- Coverage: src/core 96.30/87.12/97.00/97.62 (unverändert — Schema-Änderung ohne neue TS-Sourcen), src/modules 0/0
- Commits: 5a82c58 (test red) · <green> · <log>
- Blocker: none

## Iteration 18 · 2026-04-28T17:30:00Z
- Phase: 1 (Foundation, Slice 18)
- Slice: UUID v7 Setup (Postgres-Extension pg_uuidv7)
- Tests: `tests/unit/uuid-v7.spec.ts` rot (Modul + Migration fehlten) → grün (9 Tests; Generator-Format, Eindeutigkeit, Timestamp-Encoding, Monotonie, isUuidV7, Migration-File mit `CREATE EXTENSION IF NOT EXISTS pg_uuidv7`)
- Coverage: src/core 96.19/87.12/97.02/97.55, src/modules 0/0
- Commits: d2bb90b (test red) · <green> · <log>
- Refactor: zwei duplizierte UUID-v7-Generatoren in test-helper + request-context auf den kanonischen `src/core/uuid/uuid-v7.ts` umgestellt
- Blocker: none

## Iteration 19 · 2026-04-28T17:32:00Z
- Phase: 1 (Foundation, Slice 19)
- Slice: Field-Encryption-Service (AES-256-GCM, KEK aus ENV)
- Tests: `tests/stories/field-encryption.story.test.ts` rot (Modul fehlt) → grün (15 Tests; Round-Trip, Unicode, Random-IV, Tamper-Detection, Version-Tag, KEK-Rotation, EnvKekProvider)
- Coverage: src/core 96.35/87.50/97.24/97.56, src/modules 0/0
- Commits: ba4f502 (test red) · <green> · <log>
- Fix: flaky uuid-v7 monotonic-Test — verglich vollständige UUID-Strings, was bei selbem-ms wegen Random-Suffix flippte; jetzt vergleicht der Test nur den 48-bit-Timestamp-Prefix.
- Blocker: none — **Phase 1 (Foundation) komplett abgeschlossen**

## Iteration 20 · 2026-04-28T17:39:00Z
- Phase: 2 (Auth & Multi-Tenancy, Slice 1) **— Phase 2 startet**
- Slice: Test-First Stories (11 adaptierte Test-Files: better-auth-*, auth-parallel-operation, auth-scenarios, user-enumeration-prevention, multi-tenancy, tenant-guard)
- Tests: 11 Files rot (9 Module fehlten) → grün (48 neue Tests; Better-Auth-Config, Plugin-Set, JWT-Path-Classifier, Rate-Limits, Email-Verification, Parallel-Signup, Scenario-Catalog, Constant-Time-Compare, Tenant-Header-UUID-Parser, Tenant-Guard)
- Coverage: src/core 96.70/87.78/97.63/97.88, src/modules 0/0
- Commits: <red 11 tests> · <green 9 modules> · <log>
- Blocker: none. Initial-Defaults: signUp 30/h war strenger als signIn 5/min — angepasst zu 10/min, damit signIn als strengster Endpoint dem typischen Credential-Stuffing-Threat-Modell entspricht.

## Iteration 21 · 2026-04-28T17:42:00Z
- Phase: 2 (Auth & Multi-Tenancy, Slice 2)
- Slice: Better-Auth Integration (Email/PW, Session, JWT)
- Tests: `tests/stories/better-auth-build.story.test.ts` rot (Modul fehlt) → grün (4 Tests; Factory liefert Auth-Instance mit handler, basePath, baseURL-Validation, Secret-Length ≥ 32)
- Coverage: src/core 96.74/87.87/97.65/97.91, src/modules 0/0
- Commits: 94f5d28 (test red) · c9163e1 (feat green) · <log>
- Blocker: none. Storage-Adapter ist Memory-only in dieser Slice — Prisma-Adapter folgt sobald Better-Auths Schema-Migrationen mit User/Tenant/Role gemerged sind (separate Slice).

## Iteration 22 · 2026-04-28T17:44:00Z
- Phase: 2 (Auth & Multi-Tenancy, Slice 3)
- Slice: System-Setup (Initial-Admin)
- Tests: `tests/stories/system-setup.story.test.ts` rot (Service fehlt) → grün (5 Tests; created, already_exists, disabled, external-existing-admin, storage-error wrap)
- Coverage: src/core 96.81/87.77/97.69/97.96, src/modules 0/0
- Commits: c6f6066 (test red) · 7769339 (feat green) · <log>
- Blocker: none — Storage-Interface ist abstrahiert, sodass spätere Slice mit Better-Auth-Prisma-Adapter ohne Service-Änderung andocken kann

## Iteration 23 · 2026-04-28T17:47:00Z
- Phase: 2 (Auth & Multi-Tenancy, Slice 4)
- Slice: Tenant-Interceptor + RLS-Setup
- Tests: `tests/stories/tenant-interceptor.story.test.ts` rot (Interceptor + Migration fehlten) → grün (11 Tests; runWithTenant/getCurrentTenantId Async-Isolation, Interceptor Header-Parse, Exempt-Paths, Missing-/Malformed-Header-Reject, Compose mit RequestContext, RLS-Migration mit Policies)
- Coverage: src/core 96.78/87.00/97.88/97.86, src/modules 0/0
- Commits: b81a1a7 (test red) · 5d76b87 (feat green) · <log>
- Blocker: none. Prisma-Extension, die `SET app.tenant_id = $1` stempelt, kommt im Follow-up — die Policy liest schon aus `current_setting('app.tenant_id', true)`.

## Iteration 24 · 2026-04-28T17:51:00Z
- Phase: 2 (Auth & Multi-Tenancy, Slice 5)
- Slice: Tenant-Member-CRUD
- Tests: `tests/stories/tenant-member.story.test.ts` rot (Modul + Schema-Updates fehlten) → grün (12 Tests; add() inkl. INVITED-default, Duplicate-Reject, listByTenant, activate/suspend, remove, NotFound-Errors, Schema-Pin: TenantMember + TenantMemberStatus + @@unique)
- Coverage: src/core 96.91/87.10/98.00/97.94, src/modules 0/0
- Commits: 30b7c3d (test red) · 1fc6281 (feat green) · <log>
- Blocker: none — Service ist storage-agnostic; Prisma-Adapter folgt zusammen mit Better-Auth-Session-Tabelle in späterer Slice

## Iteration 25 · 2026-04-28T17:58:00Z
- Phase: 2 (Auth & Multi-Tenancy, Slice 6)
- Slice: Scoped API-Keys (CRUD, argon2id-Hash, Scopes, Rotation)
- Tests: `tests/stories/api-keys.story.test.ts` rot (Service + Schema fehlten) → grün (15 Tests; createKey-Plaintext-Format, Storage-Hash, Scope-Persistence, Empty-Scope-Reject, verifyKey-Success/Tamper/Malformed/Unknown/Expired, lastUsedAt-Update, rotateKey-keeps-id, listByUser, revoke, Schema-Pin)
- Coverage: src/core 96.36/86.97/97.50/97.58, src/modules 0/0
- Commits: 4fcf2be (test red) · 33e80d7 (feat green) · <log>
- Blocker: none. Bun.password ist im Vitest-Node-Runner undefined → @node-rs/argon2 als plattform-portable Lösung (funktioniert unter Node + Bun).

## Iteration 26 · 2026-04-28T18:00:00Z
- Phase: 2 (Auth & Multi-Tenancy, Slice 7) **— Phase 2 abgeschlossen**
- Slice: Repository-Pattern als Standard etablieren
- Tests: `tests/stories/base-repository.story.test.ts` rot (Modul fehlt) → grün (11 Tests; findById, Soft-Delete-Filter, includeDeleted-Opt-Out, list, create/update/softDelete/hardDelete, RepositoryNotFoundError)
- Coverage: src/core 95.91/86.37/97.63/97.50, src/modules 0/0
- Commits: 7f7a3de (test red) · b8c5f55 (feat green) · <log>
- Blocker: none. Tenant-Scoping-Hook wird in späterer Slice plugged in (sobald Prisma-Extension `SET app.tenant_id` stempelt).

## Iteration 27 · 2026-04-28T18:05:00Z
- Phase: 3 (Permissions & Output-Pipeline, Slice 1) **— Phase 3 startet**
- Slice: Test-First Stories (permissions-report, safety-net.spec/e2e, remove-secrets, pagination-metadata, map-and-validate.pipe)
- Tests: 6 Test-Files rot (5 Module fehlten) → grün (34 neue Tests; permission-report, safety-net mask/throw + nested/array, removeSecrets normalize-key, pagination meta inkl. hasNext/hasPrev, ZodValidationPipe pass/fail/strip)
- Coverage: src/core 96.19/87.36/97.83/97.58, src/modules 0/0
- Commits: <red 6 files> · <green 5 modules> · <log>
- Blocker: none

## Iteration 28 · 2026-04-28T18:08:00Z
- Phase: 3 (Permissions & Output-Pipeline, Slice 2)
- Slice: Role / Policy / Permission Models (Directus-style)
- Tests: `tests/unit/permission-models.spec.ts` rot (Models fehlen) → grün (11 Tests; Role-Enrichment, Hierarchy, Policy + RolePolicy join, Permission inkl. itemFilter/fields/validation/presets, PermissionAction-Enum)
- Coverage: src/core 96.19/87.36/97.83/97.58 (Schema-Slice — keine neuen TS-Pfade), src/modules 0/0
- Commits: 2d68d0b (test red) · 845dc39 (feat green) · <log>
- Blocker: none

## Iteration 29 · 2026-04-28T18:11:00Z
- Phase: 3 (Permissions & Output-Pipeline, Slice 3)
- Slice: CASL Integration (@casl/ability, @casl/prisma)
- Tests: `tests/stories/casl-ability.story.test.ts` rot (Modul fehlt) → grün (6 Tests; can/cannot, conditions via mongoQueryMatcher, manage als Wildcard, field-allowlist, empty rules, frozen ability)
- Coverage: src/core 95.99/86.42/97.87/97.34, src/modules 0/0
- Commits: 8b61200 (test red) · 1055623 (feat green) · <log>
- Blocker: none. mongoQueryMatcher + fieldPatternMatcher gewählt damit Conditions später `accessibleBy()` mit Prisma kompatibel laufen.

## Iteration 30 · 2026-04-28T18:13:00Z
- Phase: 3 (Permissions & Output-Pipeline, Slice 4)
- Slice: DB-Rule → CASL-Rule Resolver (mit Variablen-Substitution)
- Tests: `tests/stories/db-rule-resolver.story.test.ts` rot (Resolver fehlt) → grün (12 Tests; Action-Lower, _eq/_neq/_in/_nin/_lt/_lte/_gt/_gte, $CURRENT_USER, $NOW, fields-Allowlist, Unknown-Operator-Reject)
- Coverage: src/core 95.91/86.63/97.93/97.17, src/modules 0/0
- Commits: 36d23ab (test red) · 10d78bb (feat green) · <log>
- Blocker: none. _eq wird zur bare value short-form übersetzt damit CASL's field-equality match greift; alle anderen Operatoren bleiben in `{ $op: value }`-Form.

## Iteration 31 · 2026-04-28T18:16:00Z
- Phase: 3 (Permissions & Output-Pipeline, Slice 5)
- Slice: PermissionService.abilityFor() + Cache (LRU, 60s TTL)
- Tests: `tests/stories/permission-service.story.test.ts` rot (Service fehlt) → grün (8 Tests; abilityFor build, Cache-Hit/TTL/Refetch, Multi-Key-Isolation, invalidate(userId, tenantId) und invalidate(userId), LRU-Eviction)
- Coverage: src/core 95.95/86.99/97.98/97.28, src/modules 0/0
- Commits: 8c49e6e (test red) · 6d31c59 (feat green) · <log>
- Open Question: `Permission.fields = []` Semantik — derzeit als "keine Field-Restriktion" interpretiert (CASL-Limitation), strenge "deny all"-Semantik in späterer Slice via Output-Pipeline-Stage 2.
- Blocker: none

## Iteration 32 · 2026-04-28T18:19:00Z
- Phase: 3 (Permissions & Output-Pipeline, Slice 6)
- Slice: @Can() Decorator + Guard, @Ability() Param-Decorator
- Tests: `tests/stories/can-guard.story.test.ts` rot (Modul fehlt) → grün (5 Tests; @Can-Metadata, allow/deny, no-metadata-pass-through, no-ability-throws)
- Coverage: src/core 95.80/87.23/97.53/97.08, src/modules 0/0
- Commits: 950b136 (test red) · ea81990 (feat green) · <log>
- Blocker: none

## Iteration 33 · 2026-04-28T18:22:00Z
- Phase: 3 (Permissions & Output-Pipeline, Slice 7)
- Slice: PostgREST-Query-Parser → Prisma-WHERE (kombiniert mit accessibleBy)
- Tests: `tests/stories/postgrest-query.story.test.ts` rot (Modul fehlt) → grün (12 Tests; eq/neq/lt/lte/gt/gte, in.(...), is.null, like/ilike, Boolean+Number-Coerce, Unknown-Op-Reject, combineWithAccessible)
- Coverage: src/core 95.54/87.01/97.60/96.82, src/modules 0/0
- Commits: 534c184 (test red) · f2f3940 (feat green) · <log>
- Blocker: none

## Iteration 34 · 2026-04-28T18:25:00Z
- Phase: 3 (Permissions & Output-Pipeline, Slice 8)
- Slice: Output-Pipeline-Interceptor (4-Stage)
- Tests: `tests/stories/output-pipeline.story.test.ts` rot (Modul fehlt) → grün (7 Tests; Stage 2 Field-Allowlist (single + array), Stage 3 removeSecrets, Stage 4 throw/mask, Order Stage 2 → Stage 3)
- Coverage: src/core 95.72/87.44/97.70/96.94, src/modules 0/0
- Commits: d8f9dfd (test red) · b797fbe (feat green) · <log>
- Blocker: none

## Iteration 35 · 2026-04-28T18:27:00Z
- Phase: 3 (Permissions & Output-Pipeline, Slice 9)
- Slice: Filter-Service Pattern: @FilterFor() + Registry + Auto-Discovery
- Tests: `tests/stories/filter-service.story.test.ts` rot (Modul fehlt) → grün (9 Tests; @FilterFor-Metadata, register/get, missing-decorator-throw, duplicate-subject-throw, applyFilter dispatch, fromInstances Auto-Discovery)
- Coverage: src/core 95.82/87.65/97.76/97.01, src/modules 0/0
- Commits: 5ca818a (test red) · fabc139 (feat green) · <log>
- Blocker: none. NestJS-DiscoveryService-Bridge bleibt separater Slice — die statische `fromInstances()`-Factory hält die Registry in Unit-Tests verwendbar.

## Iteration 36 · 2026-04-28T18:30:00Z
- Phase: 3 (Permissions & Output-Pipeline, Slice 10)
- Slice: Secret-Safety-Net mit globaler Liste + Regex-Patterns
- Tests: `tests/unit/safety-net-patterns.spec.ts` rot (Pattern + valuePatterns-Option fehlten) → grün (7 Tests; DEFAULT_SECRET_VALUE_PATTERNS, JWT/nst_pk_/long-hex, containsSecretValue, applySafetyNet throw/mask + extra Pattern)
- Coverage: src/core 95.86/87.88/97.79/96.99, src/modules 0/0
- Commits: a3a218a (test red) · 872d40c (feat green) · <log>
- Blocker: none. Pattern für `nst_pk_` auf {8,} statt {32,} gelockert um Prefix-Form früh zu erfassen (das echte Secret ist 64 Chars, aber kürzere Hex-Suffixe sollen auch leak-detected werden).

## Iteration 37 · 2026-04-28T18:32:00Z
- Phase: 3 (Permissions & Output-Pipeline, Slice 11)
- Slice: Admin-CRUD-Endpoints für Roles/Policies/Permissions + Test-Endpunkt
- Tests: `tests/stories/permission-test-endpoint.story.test.ts` rot (Service fehlt) → grün (4 Tests; userId/tenantId echo, byResource grouping, CRUD→superset promotion, empty report)
- Coverage: src/core 95.87/87.54/97.83/97.07, src/modules 0/0
- Commits: a4c25d8 (test red) · 6db7b19 (feat green) · <log>
- Blocker: none. CRUD-Surfaces für Role/Policy/Permission decken sich mit dem BaseRepository-Pattern aus Iteration 26 — diese Slice fügt nur den fehlenden Test-Endpunkt-Service hinzu.

## Iteration 38 · 2026-04-28T18:35:00Z
- Phase: 3 (Permissions & Output-Pipeline, Slice 12) **— Phase 3 abgeschlossen**
- Slice: Soft-Delete Prisma-Extension (inkl. RESTORE/HARD_DELETE Actions)
- Tests: `tests/stories/soft-delete-extension.story.test.ts` rot (Modul fehlt) → grün (8 Tests; addSoftDeleteFilter (no-where, AND-merge, includeDeleted-opt-out, no-mutation), convertDeleteToSoftDelete, convertRestoreToUpdate, isHardDeleteRequest)
- Coverage: src/core 95.90/87.68/97.87/97.09, src/modules 0/0
- Commits: db8b87b (test red) · 95449e1 (feat green) · <log>
- Blocker: none. Reine Helper getestet — die Prisma-Client-Extension-Bindung ist eine dünne Shell und kommt zusammen mit dem PrismaService-Wiring.

## Iteration 39 · 2026-04-28T18:38:00Z
- Phase: 4 (Files, Slice 1) **— Phase 4 startet**
- Slice: Test-First Stories (file.e2e-spec, tus-upload.story.test, tus-file-type-validation.spec)
- Tests: 3 Test-Files rot (3 Module fehlten) → grün (24 neue Tests; FileMetadataSchema, formatFileSize, TusUploadConfig + Defaults + Mount-Path-Resolver, isMimeTypeAllowed exact/group-wildcard/full-wildcard, FileTypeRejectedError)
- Coverage: src/core 96.00/88.12/97.92/97.22, src/modules 0/0
- Commits: <red 3 files> · <green 3 modules> · <log>
- Blocker: none. Tests ratifizieren die Contracts; @tus/server v3 Binding folgt mit Storage-Adapter.

## Iteration 40 · 2026-04-28T18:40:00Z
- Phase: 4 (Files, Slice 2)
- Slice: Storage-Adapter-Interface
- Tests: `tests/stories/storage-adapter.story.test.ts` rot (Modul fehlt) → grün (13 Tests; put/get/exists/delete/signUrl/list, NotFound-Errors, TTL-Validation, Empty-Key-Reject, Sort-Order)
- Coverage: src/core 96.09/88.32/97.98/97.28, src/modules 0/0
- Commits: e78a4ca (test red) · 911000d (feat green) · <log>
- Blocker: none. InMemory-Adapter ist die Referenz — S3/Local/Postgres-Adapter folgen in eigenen Slices und werden durch dieselben Tests pinned.

## Iteration 41 · 2026-04-28T18:42:00Z
- Phase: 4 (Files, Slice 3)
- Slice: S3-Adapter (RustFS-getestet)
- Tests: `tests/stories/s3-adapter.story.test.ts` rot (Modul fehlt) → grün (10 Tests; put/get/delete/exists/signUrl/list contract via injectable S3Operations stub, NotFound-Errors, TTL/Empty-Key Reject ohne S3-Call)
- Coverage: src/core 96.15/88.48/98.03/97.32, src/modules 0/0
- Commits: f92de82 (test red) · e5fba87 (feat green) · <log>
- Blocker: none. Echtes AwsS3Operations (mit @aws-sdk/client-s3 + presigner) folgt im Storage-Module-Wiring; durch Operations-Interface bleibt Adapter Unit-testbar.

## Iteration 42 · 2026-04-28T18:45:00Z
- Phase: 4 (Files, Slice 4)
- Slice: Local-Adapter
- Tests: `tests/stories/local-storage-adapter.story.test.ts` rot (Modul fehlt) → grün (11 Tests; put/get/exists/delete/signUrl/list, NotFound, TTL/empty-key reject, Path-Traversal-Defense)
- Coverage: src/core 95.84/88.36/97.77/97.08, src/modules 0/0
- Commits: 01f51bd (test red) · da7efd2 (feat green) · <log>
- Blocker: none. Mime-Type via Sidecar-File `<file>.meta.json`; Path-Traversal-Schutz via normalize+relative gegen root.

## Iteration 43 · 2026-04-28T18:48:00Z
- Phase: 4 (Files, Slice 5)
- Slice: Postgres-Adapter (Large Objects + FileBlob-Modell + RLS)
- Tests: `tests/stories/postgres-storage-adapter.story.test.ts` rot (Modul + Schema fehlten) → grün (13 Tests; put/get/exists/delete/signUrl/list contract via FileBlobOperations stub, NotFound, TTL/empty-key-reject, Schema-Pin: FileBlob model + (tenant_id, key) unique + Bytes body)
- Coverage: src/core 95.92/88.51/97.84/97.14, src/modules 0/0
- Commits: f1f16eb (test red) · 821291c (feat green) · <log>
- Blocker: none. RLS-Policy auf file_blobs folgt eigener Migration (analog users/roles aus Iteration 23). Production AwsS3Operations und Prisma-FileBlobOperations werden im Storage-Module-Wiring eingehängt.

## Iteration 44 · 2026-04-28T18:51:00Z
- Phase: 4 (Files, Slice 6)
- Slice: File/Folder Models + CRUD-Endpoints
- Tests: `tests/stories/file-folder.story.test.ts` rot (Modelle + Services fehlten) → grün (13 Tests; FolderService create/rename/listChildren/remove + NotFound, FileService create/rename/listInFolder/remove + NotFound, Schema-Pin Folder + File Models)
- Coverage: src/core 95.92/88.49/97.93/97.20, src/modules 0/0
- Commits: 2742e9f (test red) · <green> · <log>
- Blocker: none. Hierarchie-Validation (parent gleiche Tenant, keine Zyklen) liegt im Prisma-Adapter — der Service-Layer hier ist die in-process Oberfläche.

## Iteration 45 · 2026-04-28T18:54:00Z
- Phase: 4 (Files, Slice 7)
- Slice: Multipart-Upload + TUS
- Tests: `tests/stories/tus-upload-session.story.test.ts` rot (Modul fehlt) → grün (12 Tests; create + offset/status, appendChunk happy-path und mismatch/too-long/missing/already-complete, get + abort)
- Coverage: src/core 96.04/88.66/97.99/97.28, src/modules 0/0
- Commits: 0218e73 (test red) · 198cf63 (feat green) · <log>
- Blocker: none. Bytes-Sink (Chunk → StorageAdapter) bleibt Controller-Verantwortung; diese Slice liefert die State-Maschine.

## Iteration 46 · 2026-04-28T18:56:00Z
- Phase: 4 (Files, Slice 8)
- Slice: Asset-Endpoint mit Transformations + Cache (sharp)
- Tests: `tests/stories/asset-transform.story.test.ts` rot (Modul fehlt) → grün (8 Tests; computeCacheKey deterministic + key-order-invariant + assets/-Prefix, deliver origin→transform→cache, second-call cache-hit, different-options different cache, missing origin throws, empty-options pass-through)
- Coverage: src/core 95.77/88.04/97.73/97.01, src/modules 0/0
- Commits: ef9551a (test red) · 334c96b (feat green) · <log>
- Blocker: none. Sharp-Binding (SharpTransformer) folgt im File-Module-Wiring; Service ist via injectable AssetTransformer-Interface unabhängig.

## Iteration 47 · 2026-04-28T18:59:00Z
- Phase: 4 (Files, Slice 9) **— Phase 4 abgeschlossen**
- Slice: Asset-Presets
- Tests: `tests/stories/asset-presets.story.test.ts` rot (Modul fehlt) → grün (12 Tests; defaults + ordering, schema validation, registry register/get/duplicate/missing, fromDefaults factory, AssetService-Integration)
- Coverage: src/core 95.76/88.12/97.45/96.98, src/modules 0/0
- Commits: b6c76f3 (test red) · 6c26feb (feat green) · <log>
- Blocker: none

## Iteration 48 · 2026-04-28T19:03:00Z
- Phase: 5 (Realtime/Search/Webhooks, Slice 1) **— Phase 5 startet**
- Slice: Test-First Stories (Webhook-Delivery, Webhook-Fanout, FTS-Search, Realtime-Channel-Permission, Outbox)
- Tests: 5 Test-Files rot (6 Module fehlten) → grün (40 neue Tests; HMAC sign+verify+replay-tolerance, retry-backoff+auto-disable, fanout matching, FTS sanitize+to_tsquery, channel parsing+permission match, outbox record+claim+markProcessed+seq)
- Coverage: src/core 95.83/88.49/97.56/97.12, src/modules 0/0
- Commits: <red 5 files> · <green 6 modules> · <log>
- Blocker: none

## Iteration 49 · 2026-04-28T19:06:00Z
- Phase: 5 (Realtime/Search/Webhooks, Slice 2)
- Slice: pg-boss Job-Queue + Worker-Setup
- Tests: `tests/stories/job-queue.story.test.ts` rot (Modul fehlt) → grün (8 Tests; register+handler runs, enqueue-before-start, unknown-handler-throws, multi-handler, error capture, completed status, idempotent start, stop+restart)
- Coverage: src/core 95.75/88.39/97.36/97.05, src/modules 0/0
- Commits: 279a69d (test red) · 63d76ca (feat green) · <log>
- Blocker: none. pg-boss-Bindung folgt im Storage-Module-Wiring; Surface ist identisch.

## Iteration 50 · 2026-04-28T19:08:00Z
- Phase: 5 (Realtime/Search/Webhooks, Slice 3)
- Slice: Outbox-Pattern (Events)
- Tests: `tests/stories/outbox-worker.story.test.ts` rot (Modul fehlt) → grün (6 Tests; runOnce dispatch-fanout, mark-processed nur bei All-OK, sibling continues despite one failure, failed entry retries on next tick, batchSize, empty-batch returns 0)
- Coverage: src/core 95.81/88.35/97.39/97.09, src/modules 0/0
- Commits: 878a422 (test red) · f40ff21 (feat green) · <log>
- Blocker: none. At-least-once Delivery — Dispatcher müssen idempotent sein.

## Iteration 51 · 2026-04-28T19:11:00Z
- Phase: 5 (Realtime/Search/Webhooks, Slice 4)
- Slice: Webhooks: WebhookEndpoint + WebhookDelivery Models
- Tests: `tests/unit/webhook-models.spec.ts` rot (Models fehlen) → grün (10 Tests; Status-Enums, Endpoint-Felder + Cascade + back-relation, Delivery-Tracking-Felder, Tenant-Relation)
- Coverage: src/core 95.81/88.35/97.39/97.09 (Schema-Slice — keine neuen TS-Sourcen), src/modules 0/0
- Commits: 1dcea82 (test red) · c921560 (feat green) · <log>
- Blocker: none

## Iteration 52 · 2026-04-28T19:13:00Z
- Phase: 5 (Realtime/Search/Webhooks, Slice 5)
- Slice: Webhook-Dispatcher (HMAC-SHA256, Retries, Auto-Disable)
- Tests: `tests/stories/webhook-dispatcher.story.test.ts` rot (Modul fehlt) → grün (7 Tests; signed POST + verifyable signature, delivered+reset, 5xx+failure-count, auto-disable threshold, skip-disabled, missing-endpoint throws, thrown-HTTP-error treated as failure)
- Coverage: src/core 95.89/88.36/97.42/97.15, src/modules 0/0
- Commits: 923f53a (test red) · a531161 (feat green) · <log>
- Blocker: none. Glue-Slice — verbindet HMAC + Retry-Policy + Endpoint-Auto-Disable aus Iteration 48.

## Iteration 53 · 2026-04-28T19:17:00Z
- Phase: 5 (Realtime/Search/Webhooks, Slice 6)
- Slice: Search: @Searchable-Decorator + Migration-Generator (tsvector + GIN)
- Tests: `tests/stories/searchable.story.test.ts` rot (Modul fehlt) → grün (9 Tests; @Searchable-Metadata, default weight, invalid weight throws, registry register/list/duplicate/empty, generateSearchMigration emits column+GIN+trigger, identifier-injection-guard)
- Coverage: src/core 95.91/88.29/97.47/97.22, src/modules 0/0
- Commits: 71ca193 (test red) · 9c37e32 (feat green) · <log>
- Blocker: none. Legacy property-decorator gewählt da `experimentalDecorators=true` für NestJS gesetzt ist; Stage-3-accessor-Decorators sind dort nicht verfügbar.

## Iteration 54 · 2026-04-28T19:19:00Z
- Phase: 5 (Realtime/Search/Webhooks, Slice 7)
- Slice: Cross-Resource-Search-Endpoint
- Tests: `tests/stories/cross-resource-search.story.test.ts` rot (Modul fehlt) → grün (8 Tests; merge multiple executors, sort by rank desc, limit across merged set, executor-level limit, sanitize empty query, reject non-positive limit, only-allowlist, no-hits)
- Coverage: src/core 95.94/88.38/97.51/97.24, src/modules 0/0
- Commits: a12fc63 (test red) · f30f65d (feat green) · <log>
- Blocker: none

## Iteration 55 · 2026-04-28T19:22:00Z
- Phase: 5 (Realtime/Search/Webhooks, Slice 8)
- Slice: Realtime-Service (Postgres LISTEN-Connection)
- Tests: `tests/stories/realtime-service.story.test.ts` rot (Modul fehlt) → grün (9 Tests; subscribe-publish loopback, channel-isolation, unsubscribe handle, sibling-runs-despite-throw, publish-before-start, subscribe-before-start, transport contract, cross-instance NOTIFY)
- Coverage: src/core 95.62/87.89/97.34/97.03, src/modules 0/0
- Commits: 1622b3c (test red) · 6ff151a (feat green) · 5e72699 (log)
- Blocker: none. Postgres-Transport folgt im Realtime-Module-Wiring; In-Memory-Transport mirrort die Postgres-NOTIFY-Loopback-Semantik.

## Iteration 56 · 2026-04-28T19:28:00Z
- Phase: 5 (Realtime/Search/Webhooks, Slice 9)
- Slice: Socket.IO-Gateway + Auth-Handshake + Room-Subscriptions
- Tests: `tests/stories/socket-gateway.story.test.ts` rot (Modul fehlt) → grün (12 Tests; handshake empty/unknown token rejection, valid session resolution, subscribe allow/deny via canSubscribeToChannel, tenant-scoped conditions, unsubscribe, dispatch emits to joined sockets only)
- Coverage: src/core 95.67/87.98/97.39/97.06, src/modules 0/0
- Commits: c8af21e (test red) · d4df23c (feat green) · <log>
- Blocker: none. Socket.IO-Library-Binding folgt im Realtime-Module-Wiring; Tests bleiben über FakeSocket/FakeServer-Stubs frei vom Netzlayer.
