# nest-base — Fusion Product Requirements Document

## Overview

nest-base is a production-grade NestJS starter that ships you a server you can run on day one plus a full-blown developer cockpit at /dev that knows what's running, what's failing, and what's available to switch on. 23 feature-toggleable subsystems — multi-tenancy with Postgres RLS, TUS uploads across 4 storage adapters, 9 Better-Auth plugins (incl. organisations, magic-link, passkeys, impersonation), AES-256-GCM field encryption with KEK rotation and blind index, PostGIS-backed geo, pg-boss queues, FTS search, HMAC webhooks, MCP, GDPR export & 30-day-grace deletion — each one off-by-default with zero runtime cost when disabled, each one surfaces and toggles from the cockpit. Built strict-TDD (six quality gates per commit), with AI-first tooling (skills, slash commands, autonomous Ralph loop) and a hard src/core/ ↔ src/modules/ boundary so consuming projects pull upstream improvements without losing their domain code. MIT-licensed.

This PRD describes a fusion: the existing nest-base repo (Prisma 7, Postgres 18, React 19 SPA Dev Hub, Vitest 4, AI-first tooling) is the target, and the best implementations from nest-base-alternative (9 Better-Auth plugins fully wired, 4-stage output pipeline with secret safety net, 7 stacked Prisma extensions, AES-256-GCM with KEK rotation, PostGIS ST_DWithin, pg-boss webhook outbox, audit-log + audit-stamp extensions, RustFS adapter, antivirus scanner, prom-client metrics, custom span buffer, and more) are ported into it.

## Core Features

### Auth & Identity
- Better-Auth core: email/password, sessions, sign-in/up flows
- 9 Better-Auth plugins, all feature-gated: jwt + JWKS, twoFactor (TOTP), passkey (WebAuthn), admin (listUsers, setRole, banUser, impersonateUser + audit trail), organization (multi-org + member roles + invites), magicLink (5-min signed link), oneTap (Google chooser), openAPI (auto-spec at /auth/reference)
- Social providers: Google, GitHub, Apple, Discord (env-gated)
- Brute-force protection on auth endpoints
- Password policy (entropy + breach checks)
- API keys: scoped + hashed + expiry notifier + last-used tracker + audit
- PowerSync JWT + JWKS for mobile offline sync
- Sessions admin (revoke single / bulk-by-user)
- Test-ability hatch (X-Test-Ability: full, NODE_ENV=test only)

### Multi-Tenancy & Permissions
- Tenant guard + x-tenant-id resolver + GET /me/tenants + POST /tenants
- Postgres RLS on every tenant-scoped table + runtime check (bun run check:rls)
- CASL ability + DB-rule resolver + ability cache
- @Can(action, subject) guard + @Public("reason") decorator (reason mandatory)
- Route audit: every handler must be @Can() / @Public() / allow-listed; CI fails on gaps
- 4-stage output pipeline: Translate → CASL Field Whitelist → Filter Service → Secret Safety Net (with regex pattern detection for JWT, Stripe sk_live, AWS access keys, OpenAI keys)
- Permission tester (resolve ability for User × Tenant, inspect resource × actions matrix)
- Admin CRUD for Roles / Policies / Permissions in Dev Hub

### Data & Persistence
- Prisma 7 driver-adapter mode + PrismaService
- 7 stacked Prisma extensions (outside-in): softDelete → auditStamp → fieldEncryption → versionBump → audit → queryTracker → uuidV7
- audit-stamp extension: auto-fill tenantId / createdBy / updatedBy
- audit-log extension: capture every CUD with before/after diff into AuditLog (opt-in per-model)
- UUID v7 generated app-side (replaces pg_uuidv7)
- Soft-delete extension
- ETag / If-Match optimistic concurrency
- Repository pattern (BaseRepository)
- Per-feature schema concat (prisma/features/*.prisma → schema.generated.prisma)
- PostGIS 3.5 baseline + ST_DWithin nearby queries

### Files & Storage
- TUS resumable uploads
- 4 storage adapters: S3 (RustFS-compatible) · Local FS · Postgres LO · RustFS-native
- Antivirus scanner integration (ClamAV-compatible interface)
- IPX image transforms (/_ipx/*, Nuxt-Image-compatible) + AssetPresets + variant cache
- File / Folder metadata (Prisma) + tenant-scoped RLS
- Upload security (MIME sniffing, size limits, file-type validation)
- File Manager UI (/dev/files): folder tree + grid + thumbnails + breadcrumbs

### Email
- EmailService (Nodemailer + Brevo + SMTP transports)
- React Email .tsx templates (no EJS)
- Email Outbox (at-least-once dispatch, exponential backoff 1m → 5m → 25m → 2h cap, 5 attempts → DLQ)
- /health/ready trips to 503 when outbox lag exceeds 30s
- Locale fallback + recipient blocklist + per-recipient rate limiter
- Visual Email Builder UI (/dev/email-builder): block palette + live preview + module overlay + reset-to-default
- Email Preview (/dev/email-preview): every template with sample payload
- Brand-aware layouts via single-file brand.json

### Realtime
- LISTEN / NOTIFY → Socket.IO gateway
- @RealtimeChannel decorator + permission filter
- Outbox-to-realtime bridge (pg-boss → socket events)
- Realtime Inspector UI (/admin/realtime): Sockets / Channels / Events tabs, per-socket disconnect, payload replay, 1.5s poll, PII masking

### Webhooks
- HMAC-signed outbound webhooks with retry policy
- Webhook event registry + @WebhookEvent decorator + secret format
- pg-boss-driven dispatcher with delivery worker + DLQ
- Webhook Inspector UI (/admin/webhooks): endpoints + recent deliveries + re-deliver action

### Jobs & Scheduling
- pg-boss adapter (replaces in-memory queue)
- @ScheduledJob cron decorator
- Jobs Dashboard (/dev/jobs + /admin/jobs): queues / jobs / retry-failed / payload drawer
- Cron Inspector (/dev/cron): pgboss.schedule table view

### Observability
- OpenTelemetry SDK + traceparent middleware
- Pino logger with nestjs-pino integration
- Ring-buffer log capture (last 500 records, hooks.logMethod, no hot-path latency tax)
- Custom span buffer for /dev/traces (parallel SpanProcessor to OTLP exporter)
- Prisma query buffer (500-entry, >50ms warn / >200ms bad)
- Live request traces UI with click-to-expand DB queries by requestId
- Prometheus /metrics (prom-client)
- Heap / uptime / probe diagnostics

### Security
- AES-256-GCM field encryption + KEK rotation + blind index for searchable encrypted fields
- Helmet + path-aware CSP (no unsafe-inline on JSON APIs)
- Multi-window rate limiting (Postgres-backed, 1s / 1min / 1h)
- Stripe-style Idempotency-Key with sha256 fingerprint
- Cookie security (SameSite=lax, httpOnly, Secure in prod)
- Cross-tenant write-breach guard (story tested)

### Search
- Postgres FTS + cross-resource search registry + @Searchable decorator
- tsquery diagnostics + ts_headline highlighting
- Search Tester UI (/admin/search)

### Geo & Location
- Geocoding cache (4 providers: mapbox / google / nominatim / local)
- PostGIS ST_DWithin nearby search
- Address PII encryption
- GeoJSON output mapper
- Offline GeoIP (.mmdb, dbip-lite default + maxmind opt-in, with attribution)

### Integration
- MCP server (Model Context Protocol) + decorators + auth guard
- MCP admin-roles tool wired
- PowerSync (mobile offline sync, JWT + JWKS + CRUD router + sync rules)

### GDPR
- /me/export async export jobs
- /me/account deletion with 30-day grace period

### Audit
- AuditLog table + Prisma extension capture (every CUD, opt-in per-model)
- Before/after JSON diff
- Tenant scope + actor + IP capture
- Audit Browser UI (/admin/audit): filters (action / resource / actor / from / to) + diff visualisation

### Errors & API Stability
- CORE_* error code catalog + RFC 7807 problem-details filter
- Errors page (/errors) with JSON viewer
- ResourceNotFoundError canonical sentinel mapped to 404 + CORE_NOT_FOUND
- API stability promise (semver + deprecation rules)
- Deprecation header alias (/api-docs-json → /api/openapi.json with Deprecation:)

### OpenAPI / SDK
- OpenAPI 3.1 via @nestjs/swagger
- Scalar API Reference UI at /api/docs
- Zod → OpenAPI bridge (@ApiZodBody / @ApiZodResponse / @ApiZodQuery / @ApiZodParam + registerZodSchema)
- kubb SDK generator from /api/openapi.json
- Offline OpenAPI snapshot (docs/openapi.snapshot.json) for SDK consumers
- CI snapshot drift check + SDK drift check

### Dev Hub & DX
- React 19 SPA shell (shadcn/ui · Radix · Tailwind 4 · lucide-react · sonner · TanStack Query · React Router 7)
- Cockpit (/dev): health verdict, 4-tile summary, probes, log preview, feature matrix, quick nav
- Feature toggles (/dev/features): flip → patch .env → restart → reload
- Dev pages: Diagnostics, Logs, Traces, Queries, Routes, ERD, Coverage, Tests, Email Preview, Email Builder, Email Outbox, File Manager, Jobs, Migrations, Errors, OpenAPI, JSON viewer, postgrest-parse, Brand
- Admin pages: Audit, Roles, Policies, Permissions, Permission Tester, Search Tester, Webhook Inspector, Realtime Inspector, Sessions, Jobs Admin
- Dev Session runner: spawns Postgres, Prisma Studio, watches .env, opens browser, picks free port
- Cloudflare Tunnel mode (bun run dev --tunnel)
- Portless integration (auto-HTTPS at https://api.<project>.localhost)

### Setup & Lifecycle Scripts
- bun run setup — generate .env with strong secrets, hashed COMPOSE_PROJECT_NAME per workspace
- bun run onboard — first-run sanity check
- bun run doctor — deep health check (containers, secrets, disk, JSON output for CI)
- bun run reset — wipe DB + migrate + seed (refuses on prod / non-local DBs)
- bun run seed — deterministic demo data (2 tenants, 6 users, sample records)
- bun run rename — patch package.json + README + portless.yml + docker-compose.yml
- bun run add:module — scaffold tenant-scoped resource (controller / service / DTO / module / story tests)
- bun run sync:from-template + bun run sync:to-template — bidirectional core sync
- bun run sdk:generate + bun run sdk:check — kubb-driven, CI drift gate
- bun run dump:openapi — refresh offline snapshot
- bun run docs:screenshots — Playwright re-shoot of every dev-portal page
- bun run llm-test — headless agent feature test loop
- bun run check:rls — runtime RLS verification

### AI-driven Development
- Six quality gates per commit: lint, format, test:types, test:unit, test:e2e, test:coverage, build
- Strict TDD: red → green → refactor, story tests in tests/stories/
- .claude/ skills (13+ procedural how-tos), slash commands (/add-feature, /add-module, /add-page, /upstream-pr, /llm-test), agents (quality-gate-runner, module-scaffolder, feature-toggle-implementer)
- .ralph/ autonomous-loop config + ralph-import workflow
- CLAUDE.md orientation at root + per-folder navigation guides
- Two-way upstream sync flow with auto-PR offer back to nest-base

## Technical Requirements

### Frontend (Dev Hub SPA only — no separate consumer frontend)
- TypeScript 5.9 strict (exactOptionalPropertyTypes, nodenext)
- React 19 + react-dom
- React Router 7
- shadcn/ui (Radix primitives) + Tailwind CSS 4 + bun-plugin-tailwind
- lucide-react icons
- sonner toasts
- @tanstack/react-query 5
- @tanstack/react-virtual (jobs / logs / queries lists)
- clsx + tailwind-merge + class-variance-authority
- Build: bun run build:dev-portal (bundled into Bun build)
- Responsive: desktop + mobile screenshot baseline (1440 + 390)
- No PWA / service workers — dev-only surface, 404s in production

### Backend
- Bun 1.3+ runtime (Node 22 fallback for Vitest type-tests)
- TypeScript 5.9 strict, ESM nodenext, .js import suffix
- NestJS 11 (Express platform)
- Zod 4 (single source of truth for env + DTOs + features)
- REST + OpenAPI 3.1 + Scalar UI at /api/docs
- Better-Auth 1.6 + 9 plugins
- CASL 6 (@casl/ability + @casl/prisma)
- @nestjs/platform-socket.io (Socket.IO 4)
- argon2 (@node-rs/argon2) for passwords
- Helmet 8 + path-aware CSP
- RFC 7807 Problem Details
- Pino 10 + nestjs-pino + pino-pretty (dev)
- OpenTelemetry SDK + auto-instrumentations + custom span buffer
- prom-client → /metrics
- reflect-metadata + rxjs

### Database & Persistence
- Postgres 18 + PostGIS 3.5 (multi-arch via imresamu/postgis:18-3.5)
- Prisma 7 driver-adapter mode (@prisma/adapter-pg)
- pg 8.20+
- prisma migrate (production) + db push (local fast path); prisma/features/*.prisma concat → schema.generated.prisma
- Per-tenant RLS on every tenant-scoped table; bun run check:rls runtime verification
- UUID v7 generated app-side (src/core/uuid/)
- Extension stack (outside-in): softDelete → auditStamp → fieldEncryption → versionBump → audit → queryTracker → uuidV7
- pg-boss 12 (Postgres-backed queue, no Redis)
- Postgres-backed multi-window throttler

### Storage
- Default: Local FS in dev, S3 (RustFS) in prod-like environments
- Adapters: S3 (RustFS-compatible) · Local FS · Postgres LO · RustFS-native
- TUS uploads (@tus/server + @tus/file-store)
- IPX 3 (/_ipx/*, Nuxt-Image-compatible) + sharp 0.34
- Pluggable antivirus scanner (ClamAV-compatible interface)
- File metadata in Postgres (Files / Folders, tenant-scoped)

### Email
- Nodemailer 7 (SMTP) + Brevo (@getbrevo/brevo)
- React Email 1+ (@react-email/components + @react-email/render)
- Mailpit at :8025 for dev SMTP capture
- pg-boss-driven outbox with exponential backoff (1m → 5m → 25m → 2h cap, 5 attempts → DLQ)

### Testing
- Vitest 4 + @vitest/coverage-v8
- Testcontainers (@testcontainers/postgresql)
- supertest 7
- k6 (tests/k6/*.js)
- Coverage gate: core ≥ 80% lines · modules ≥ 75% lines
- Six quality gates: lint, format, test:types, test:unit, test:e2e, test:coverage, build

### SDK
- kubb 4 (@kubb/cli + @kubb/plugin-oas + @kubb/plugin-ts) from /api/openapi.json
- Snapshot at docs/openapi.snapshot.json with CI drift gate

### Lint / Format
- oxlint 1+
- oxfmt 0.47+
- Default formatter: oxc in .vscode/

### Infrastructure
- Docker Compose for dev deps (Postgres+PostGIS · Mailpit · RustFS+init · OTel Collector)
- Multi-stage Dockerfile for prod (bun run dist/main.js)
- portless 0.11 for local HTTPS (https://api.<project>.localhost)
- cloudflared for public dev URL (bun run dev --tunnel)
- Default deployment story: Docker Compose on a VM
- Production secrets: .env file mounted into the container; boundary documented in docs/security.md

### CI/CD
- Canonical pipeline: GitHub Actions (.github/workflows/ in template)
- Downstream-consumer parallel: .gitlab-ci.yml.example shipped (some lenne.tech projects deploy via GitLab)
- Required checks: all six gates green + bun run check:rls + OpenAPI snapshot drift + SDK drift
- Coverage reporting: LCOV → coverage/lcov.info → /dev/coverage page
- Test summary: JSON reporter → coverage/test-summary.json → /dev/tests page

## Out of Scope

### Architecture
- GraphQL — REST + OpenAPI 3.1 + kubb SDK only
- MongoDB / Mongoose — Postgres + Prisma only
- Vendor-Mode (vendoring src/core/ into a downstream project) — bun run sync:from-template is the only sync path
- Multi-region replication / sharding / CRDB — single Postgres primary
- Microservices — single NestJS app with feature toggles

### Auth & Permissions
- Legacy @Restricted / @Roles decorators — CASL @Can() only
- @UnifiedField decorator
- Custom OAuth issuance — Better-Auth jwt() plugin handles issuance; we never write a custom issuer
- Custom session stores beyond Better-Auth Prisma adapter

### Frontend
- Separate consumer frontend — the React 19 SPA at /dev is dev-tooling only, 404s in production
- PWA / service workers / offline support for the dev hub
- No-build static admin templates (alt's SSR HTML rejected)

### Email
- Mailjet — Nodemailer (SMTP) + Brevo only
- EJS templates — React Email .tsx only
- process()-style raw pipelines — outbox + dispatcher pattern only

### Storage & Media
- Built-in CDN / image-hosting service — IPX runs in-process
- Video transcoding / streaming
- WebRTC / live media

### Business / Domain
- Built-in payments / billing / Stripe checkout — Stripe is referenced only for Idempotency-Key + secret-safety-net regex
- Built-in CMS / content authoring
- Built-in business analytics / BI dashboards
- Domain modules in src/core/ — anything project-specific lives in src/modules/

### Tooling
- npm / pnpm / yarn — Bun-only (Node 22 only for Vitest type-tests)
- Jest / Mocha — Vitest 4 only
- ESLint / Prettier — oxlint + oxfmt only
- Docker Swarm / Kubernetes / k3s manifests in tree — Docker Compose on a VM is the deployment story
- Cloud-provider-native secret managers (AWS Secrets Manager, GCP Secret Manager, Doppler, Infisical, SOPS) baked into core — .env mount is default

### AI
- Embedding / vector search / pgvector — FTS only; consumers add pgvector in src/modules/
- LLM inference servers / OpenAI proxying — MCP is the only AI integration

## Success Criteria

### Quality Gates
- bun run lint && bun run format:check && bun run test:types && bun run test:unit && bun run test:e2e && bun run test:coverage && bun run build all pass
- Coverage: src/core/** ≥ 80% lines, src/modules/** ≥ 75% lines
- Test count ≥ 2000 across tests/**
- bun audit --severity high reports 0 advisories
- bun run prepare:schema:check reports no drift
- bun run sdk:check reports no drift
- bun run dump:openapi snapshot is byte-identical to docs/openapi.snapshot.json

### Boot & Feature Surface
- bun run dev boots end-to-end in < 5 s cold (M-series Mac, default-ON features only) and prints the Dev-Hub URL
- /health/live returns 200 in < 50 ms median
- /health/ready returns 200 with all probes (DB, storage, jobs, OTel, email) reporting OK
- All 23 feature flags listed at /dev/features.json and toggleable from /dev/features
- Flipping a feature OFF in the UI patches .env, restarts the server, and removes the feature's routes from /dev/routes.json within 5 s
- All 9 Better-Auth plugins mountable: feature-flag-gated routes appear in route audit when enabled, absent when disabled
- Each opt-in feature has at least one e2e test that boots the server with FEATURE_<KEY>_ENABLED=true and exercises one route
- Heap snapshot 5s after boot with all opt-in features OFF is ≥ 50 MB lower than with all ON

### Per-subsystem
- bun run check:rls reports zero drift between expected and pg_class.relrowsecurity
- tests/stories/route-gating-audit.story.test.ts reports 0 unguarded routes
- Story test serialises { secret: "sk_live_..." } and proves the safety net redacts each of JWT, Stripe sk_live, AWS access key, OpenAI key patterns
- Story test mutates an opted-in model and verifies an AuditLog row with before/after JSON diff
- Story test creates a row without tenantId / createdBy and verifies the audit-stamp extension auto-fills both
- Chaos test kills email-outbox worker mid-dispatch, restarts, message leaves SMTP exactly-once (deduped by idempotency-key)
- Story test triggers a webhook event, asserts HMAC signature, verifies retry policy on 500 (1m → 5m → 25m, DLQ after 5)
- Story test writes an encrypted field, dumps raw row via pg, verifies plaintext is not present
- Story test rotates KEK, verifies existing rows decrypt under new key
- Story test inserts two points 100m apart, verifies ST_DWithin(150) returns both, ST_DWithin(50) returns one
- Story test fires same Idempotency-Key twice on POST, verifies second response is cached first response (200, not 201)
- tests/cross-tenant-write-breach.e2e-spec.ts proves User from Tenant A cannot write into Tenant B
- Story test impersonates target user, makes a request, verifies Session.impersonatedBy and INVOKE audit row with kind: IMPERSONATION_START

### Performance Budgets
- Cold start (default-ON features only): < 5 s
- /health/live median: < 50 ms
- Tenant-scoped CRUD median (with DB + RLS): < 200 ms
- p95 Prisma query duration: < 200 ms
- Initial heap (default-ON features only): < 200 MB
- Build artefact size (dist/): < 100 MB
- bun run llm-test headless run completes without hard-fail

### Security
- Helmet headers present on every response (CT, X-Frame, X-Content-Type, Referrer-Policy)
- CSP path-aware: no unsafe-inline on JSON API responses
- Cookies: httpOnly + SameSite=lax + Secure when NODE_ENV=production
- Story test asserts bun run reset refuses when NODE_ENV=production and when DATABASE_URL host is non-local
- setup-wizard generates secrets with ≥ 256 bits of entropy for BETTER_AUTH_SECRET and KEK seed

### DX & AI Tooling
- All slash commands (/add-feature, /add-module, /add-page, /upstream-pr, /llm-test) produce passing six-gate green build on clean run
- All .claude/skills/*.md reference files that exist on disk (no broken procedure links)
- bun run docs:screenshots reproduces every dev-portal page without unexpected pixel diffs
- Two-way sync round-trip works: fix in src/core/ of downstream project flows back via bun run sync:to-template + /upstream-pr, and bun run sync:from-template re-applies it cleanly

### Fusion-specific
- Every feature listed in Core Features has a file under src/core/<feature>/ (mapping table in docs/fusion-inventory.md)
- tests/stories/fusion-port-completeness.story.test.ts enumerates every alt-sourced subsystem (audit-log extension, audit-stamp extension, KEK rotation, blind-index, ST_DWithin, RustFS adapter, webhook event registry, pg-boss cron, prom-client /metrics, GeoIP, antivirus scanner, recipient rate-limiter, locale fallback) and asserts each is reachable, configured by its feature flag, and exercised by an e2e
- Current's src/core/ baseline tests all still pass (regression-free fusion)

## Priority

1. **Phase 1 — Foundation alignment** (the gate for everything else; cross-cutting changes that affect every other feature's contract):
   - Postgres image swap → imresamu/postgis:18-3.5
   - Structured 23 feature-flag schema (fuse alt's breadth onto current's nested-section pattern)
   - pg-boss adapter replaces in-memory JobQueueService
   - Audit Prisma extensions wired into the stack (audit-stamp + audit-log)
   - Secret safety net regex pattern detection (port alt's catalog into current's safety-net.ts)
   - All 9 Better-Auth plugins verified mountable & feature-gated end-to-end
   - pg-boss-driven webhook outbox dispatcher
   - Email outbox migrated to pg-boss tick

2. **Phase 2 — Feature porting** (risk-ordered: encryption + KEK first, then storage, then auth hardening, then realtime/jobs/observability):
   - AES-256-GCM KEK rotation + blind index for searchable encrypted fields
   - Brute-force protection + password policy on auth endpoints
   - API keys: scoped + hashed + expiry notifier + last-used tracker + audit
   - RustFS-native storage adapter (4th adapter)
   - Antivirus scanner integration
   - PostGIS ST_DWithin nearby search + address-PII encryption + GeoJSON output mapper
   - Repository pattern (BaseRepository)
   - Email: locale fallback + recipient blocklist + per-recipient rate limiter
   - Realtime: outbox-to-realtime bridge + channel decorator + permission filter
   - GDPR 30-day grace deletion ported into current's gdpr/
   - MCP admin-roles tool wired
   - Impersonation controller + audit trail
   - Sessions admin pane
   - Prometheus /metrics (prom-client)
   - nestjs-pino integration
   - Custom span buffer for /dev/traces
   - Ability cache in CASL resolver

3. **Phase 3 — Dev Hub completeness + docs + AI tooling**:
   - SPA pages ported from alt's SSR: /admin/audit (with diff viz), /admin/jobs (retry-failed), /admin/roles + /policies + /permissions CRUD, /admin/sessions, /dev/cron
   - Permission tester resource × actions matrix view
   - Webhook inspector enhancements (delivery history, re-deliver button)
   - File Manager UI finalisation (TUS upload UI, drag-and-drop move, multi-select, lightbox, share-link, visibility toggle, server-side zip)
   - Email Builder finalisation (reset-to-default flow, read-only source view fallback)
   - docs/architecture.md updated to reflect merged module list
   - docs/fusion-inventory.md (mapping table per feature → file → source)
   - docs/customization-guide.md updated for new opt-ins
   - docs/security.md (new) — secret-management boundary, RLS contract, output pipeline guarantees
   - docs/webhook-spec.md updated for outbox + event registry
   - All .claude/skills/*.md validated against merged repo
   - Slash commands smoke-tested: /add-feature, /add-module, /add-page, /upstream-pr, /llm-test
   - .ralph/ config updated to point at merged spec
   - bun run docs:screenshots regenerates every dev-portal page

## Timeline

ASAP, no fixed external date. Solo execution via autonomous Ralph loop with --max-iterations 200 (large multi-phase class).

Estimated iteration budget:
- Phase 1: 30–50 iterations
- Phase 2: 80–120 iterations
- Phase 3: 40–60 iterations
- Total: 150–230 iterations

Hard technical constraints:
- Bun 1.3+ and Node 22+ (Node only for Vitest type-tests)
- Prisma 7 + driver-adapter (no binary engines on production hosts)
- Postgres 18 + PostGIS 3.5 via imresamu/postgis:18-3.5 (multi-arch)
- React 19 + Tailwind 4 (pin patch versions in bun.lock)
- Better-Auth 1.6.x (1.7 not yet evaluated)
- Six quality gates per commit non-negotiable
- Strict TDD: red → green → refactor; no it.skip, no --no-verify, no --force
- src/core/ ↔ src/modules/ boundary preserved at every commit; bun run sync:from-template smoke test in CI

Soft constraints:
- One slice = one PR (or one Ralph iteration). No mega-merges.
- Coverage never regresses.
- No new dependency without (a) a feature flag if it's optional, or (b) a story test demonstrating it's actually used.
- Every alt-sourced port carries an attribution line in its file header (/* ported from nest-base-alternative — date — commit */).
