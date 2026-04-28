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
