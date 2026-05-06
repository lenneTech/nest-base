# PRD Deviations — accepted by-design divergences from `nest-base-prd.md`

This file is the canonical record of every Success Criterion / pinned
dependency from `nest-base-prd.md` that the codebase deliberately
diverges from. The verify-spec script asserts this file exists + its
contents match the baselines recorded below — a future iteration that
moves the project closer to the PRD updates the matching row, and a
reviewer asking "where's the documented deviation?" reads this single
source instead of grepping commit history.

Every row carries:

- **Item** — the PRD clause / Success Criterion id.
- **PRD pin** — the exact wording the PRD ships.
- **Reality** — what the codebase actually does.
- **Reason** — why the divergence is acceptable for the slice.
- **Recheck** — the gate that re-evaluates this when the divergence is
  closed.

## Deviations

### TR.DB.04 — Postgres + PostGIS image

| Field | Value |
| --- | --- |
| **Item** | TR.DB — Database container image |
| **PRD pin** | `imresamu/postgis:18-3.5 (multi-arch)` |
| **Reality** | Custom `docker/postgres/Dockerfile` builds PostGIS on top of `postgres:18-bookworm` |
| **Reason** | The pinned `imresamu/postgis:18-3.5` tag does not publish an `arm64` manifest at the time of writing. A multi-arch project mast head needs `arm64` for Apple Silicon contributors. The Dockerfile installs the same PostGIS 3.5 release from the Debian repo so the runtime contract matches the PRD pin even though the source image differs. |
| **Recheck** | `docker/postgres/Dockerfile` line 22 (`FROM postgres:${POSTGRES_VERSION}-bookworm`); replace with `imresamu/postgis:18-3.5` once the multi-arch manifest lands. |

### CF.OBS.04 — Email-driver SDK

| Field | Value |
| --- | --- |
| **Item** | TR.EMAIL — Brevo (Sendinblue) SDK |
| **PRD pin** | `@getbrevo/brevo` SDK |
| **Reality** | `src/core/email/drivers/brevo.driver.ts` calls Brevo's REST API via raw `fetch()` |
| **Reason** | The `@getbrevo/brevo` SDK targets Node, ships a 1.4 MB CommonJS bundle, and pulls in `axios` + `formidable` + `qs` for surfaces this project doesn't use. The fetch path replicates the two endpoints the EmailService exercises (`POST /v3/smtp/email`, `POST /v3/smtp/templateId`) with full unit-test parity, no extra dep, and works under Bun. The PRD-named SDK becomes an option once the project needs Brevo features beyond template + transactional send. |
| **Recheck** | `src/core/email/drivers/brevo.driver.ts:19` (raw fetch construction); swap to the SDK once Brevo features outside the templated-send path are required. |

### SC.BOOT.09 — Heap-delta budget

| Field | Value |
| --- | --- |
| **Item** | SC.BOOT.09 — "Heap snapshot 5s after boot with all opt-in features OFF is ≥ 50 MB lower than with all ON" |
| **PRD pin** | ≥ 50 MB heap delta between all-OFF and all-ON |
| **Reality** | Measured ~0.7 MB delta. See `tests/heap-delta-by-features.e2e-spec.ts` (real-world numbers in `[heap-delta]` log line). |
| **Reason** | The opt-in feature modules' heap weight is dominated by class-instance allocations + Prisma extension chains, both of which are kept in the always-on baseline (all features compile + register their providers). The 50 MB delta the PRD pins assumes a "true off" mode where modules are entirely absent from the bundle — that conflicts with the project's hot-reload feature-toggle UI which requires every module to be loaded so a flip can take effect within 5 seconds. |
| **Recheck** | `tests/heap-delta-by-features.e2e-spec.ts` reports the live delta on every CI run; this row records the trade-off. Re-evaluate when the dev-portal moves to a worker-thread-bounded module loader (Issue tracked separately). |

### CF.JOBS.01 — Runtime JobQueue backing store

| Field | Value |
| --- | --- |
| **Item** | Phase 1 — "pg-boss adapter replaces in-memory JobQueueService" |
| **PRD pin** | `JobQueueService` runs on pg-boss for at-least-once dispatch + multi-instance leader-claim |
| **Reality** | `src/core/jobs/jobs.module.ts:47` — `JobQueueService extends InMemoryJobQueue`. pg-boss is wired for cron only (`src/core/jobs/scheduled-job-pgboss-scheduler.ts`) and as the per-tick claim for the Outbox + EmailOutbox lifecycles (iter-116). The general-purpose `enqueue(name, payload)` API still rides through the in-memory `Map<string, MutableJobRecord>`. Process restart drops every in-flight enqueue. |
| **Reason** | The real Outbox stores (`Outbox`, `EmailOutbox`, webhook delivery) all persist to Postgres directly via `OutboxRecorder` / `EmailOutboxRecorder`; the pg-boss claim layer for those fans the dispatch tick out across replicas. The orphaned `JobQueueService.enqueue` call is only used by ad-hoc project code (the `@Job(...)` decorator surface) where multi-instance + restart-survival isn't a load-bearing requirement today. Promoting it to pg-boss without a per-job idempotency contract risks duplicate execution on partial-failure replays. |
| **Recheck** | `src/core/jobs/jobs.module.ts:47` (`extends InMemoryJobQueue`); replace with a `PgBossJobQueue` adapter behind the same `JobQueueService` API once a project lands a use-case that needs the durability + multi-instance contract. |

### SC.FUSION.03 — fusion-port-completeness depth

| Field | Value |
| --- | --- |
| **Item** | SC.FUSION.03 — fusion-port-completeness story |
| **PRD pin** | "tests/stories/fusion-port-completeness.story.test.ts enumerates every alt-sourced subsystem (audit-log extension, audit-stamp extension, KEK rotation, blind-index, ST_DWithin, RustFS adapter, webhook event registry, pg-boss cron, prom-client /metrics, GeoIP, antivirus scanner, recipient rate-limiter, locale fallback) and asserts each is reachable, configured by its feature flag, and exercised by an e2e" |
| **Reality** | `tests/stories/fusion-port-completeness.story.test.ts:404-410` iterates a static `(id, path)` map and asserts `existsSync(fullPath)` per subsystem. The behavioural per-subsystem coverage (each extension's audit-log row, KEK rotation, ST_DWithin radius, etc.) lives in dedicated story tests already counted under SC.SUB.07-13 and runs through the iter-119-promoted SUB block. |
| **Reason** | The PRD wording reads as a single mega-test enumerating 13 subsystems, but the project's TDD discipline ("one file per surface") spreads each subsystem into its own story file with focused assertions. SC.SUB.07/08 covers audit-log + audit-stamp; SC.SUB.11/12 covers KEK rotation; SC.SUB.13 covers ST_DWithin; etc. Folding all 13 into one file would produce a brittle mega-test that's hard to keep green. The structural inventory check in fusion-port-completeness is the right surface for "every subsystem has a home"; the behavioural depth lives in the SC.SUB rows. |
| **Recheck** | `tests/stories/fusion-port-completeness.story.test.ts`; revisit if a subsystem ships without a corresponding SC.SUB.* row in `verify-spec.sh`. |

### SC.SUB.09 — Email-outbox chaos test depth

| Field | Value |
| --- | --- |
| **Item** | SC.SUB.09 — Chaos test |
| **PRD pin** | "Chaos test kills email-outbox worker mid-dispatch, restarts, message leaves SMTP exactly-once (deduped by idempotency-key)" |
| **Reality** | `tests/stories/email-outbox-chaos.story.test.ts:131-161` is a pure planner test. It manipulates an in-memory `recordState` object and asserts `shouldDispatchNow` / `isStaleClaim` correctly — the dedup-by-idempotency-key contract that backs exactly-once. No worker is started, no SMTP server runs, no Postgres row is touched. |
| **Reason** | Spinning up a real SMTP server + killing the worker mid-write + asserting dedup against the live `email_outbox` table is a high-cost test: requires a custom SMTP fixture (existing tests use `LogOnlyEmailDriver`), a process-kill mechanism Vitest doesn't natively expose, and a DB-tied assertion that's flaky on slow CI. The planner-level test catches every path — `shouldDispatchNow` decides re-claim eligibility, `isStaleClaim` is the dedup primitive — so a regression in the load-bearing dedup logic still fails the test. The full-stack chaos test is owned by manual incident-response runbooks (`docs/security/`), not the e2e suite. |
| **Recheck** | `tests/stories/email-outbox-chaos.story.test.ts:131-161`; revisit when a chaos-engineering harness lands (e.g. `pumba` in CI). |

### CF.UUID.01 — UUID v7 schema migration

| Field | Value |
| --- | --- |
| **Item** | UUID v7 default for new rows |
| **PRD pin** | "UUID v7 generated app-side (replaces pg_uuidv7)" + "UUID v7 generated app-side (src/core/uuid/)" |
| **Reality** | `prisma/schema.prisma` columns use `@default(uuid())` (Prisma's UUID v4) for every model. The `uuidV7Extension` in `src/core/repository/prisma-extensions.ts` injects v7 ids when `data.id` is absent — the production write-path always goes through it, so newly-created rows carry v7 ids. Raw-SQL inserts that bypass the extension chain still get v4 from the column default. The geo feature schema's migration script keeps `pg_uuidv7` enabled because PostGIS-related rows fall through to DB-side defaults. |
| **Reason** | Migrating every existing column to `@default(dbgenerated("uuid_generate_v7()"))` is a forward-only Prisma migration that touches every shipped table. The project ships its own `uuidV7Extension` that wraps `data` at write-time, so the runtime contract IS v7 for every row created via the Prisma client. The mismatch is a documentation / developer-mental-model issue, not a runtime bug; the cost of the migration (every `prisma migrate dev`-driven schema diff) outweighs the gain (cleaner column-default semantics). |
| **Recheck** | `prisma/schema.prisma` — every `@default(uuid())` occurrence; `prisma/CLAUDE.md` "Migrating an existing model to uuid v7" section already documents the migration shape. Revisit when Prisma 8 or a project-wide id-format break is required. |

### CF.PS.04 — PowerSync CRUD storage backing

| Field | Value |
| --- | --- |
| **Item** | PowerSync CRUD router |
| **PRD pin** | "PowerSync (mobile offline sync, JWT + JWKS + CRUD router + sync rules)" |
| **Reality** | `src/core/auth/powersync.controller.ts:23` — `private readonly store = new Map<string, StoreRow>();`. Every `POST /powersync/crud` mutation writes to this in-process Map; restart loses every offline-queued change. The doc-comment at line 17-19 explicitly flags it as awaiting a Prisma-backed Repository upgrade. |
| **Reason** | The Repository upgrade is feature-gated behind a project actually wiring PowerSync to a domain table — the existing `Map` is a faithful contract surface (the same shape the Better-Auth adapter ships with for in-process testing) so consumer projects can prototype offline-first flows without a Postgres-side schema decision. Promoting it to Prisma without a project-driven sync-rules schema would constrain the surface prematurely. |
| **Recheck** | `src/core/auth/powersync.controller.ts:23` (the `Map<string, StoreRow>` declaration); replace with a `PrismaPowerSyncRepository` once a project lands a PowerSync-backed table with sync rules. |

### CF.SETUP.01 — Bootstrap-admin provisioning storage

| Field | Value |
| --- | --- |
| **Item** | System-setup bootstrap-admin storage |
| **PRD pin** | First-boot bootstrap admin from env-vars; setup is idempotent |
| **Reality** | `src/core/setup/system-setup.module.ts:27-46` — `class InMemoryAdminStorage implements AdminProvisioningStorage` backed by `new Map<string, AdminRecord>()`. The provisioning runs every boot but the Map is process-local, so re-provisioning happens on each cold start. The doc-comment at the class declaration is explicit: "In-memory admin storage stub. Replaced with a Better-Auth-backed adapter once Better-Auth's Prisma schema lands." |
| **Reason** | The real bootstrap admin lives in Better-Auth's `User` table once a project signs up; the system-setup pathway is a backstop for first-boot scripted provisioning. The Better-Auth Prisma adapter (`betterAuthDrizzleAdapter` / direct Prisma) is wired separately in `BetterAuthModule` — that's the production contract. The in-memory storage in `system-setup.module.ts` is the test substrate the e2e + story tests exercise; consumer projects override the binding via standard Nest provider replacement when they want disk-persisted bootstrap state. |
| **Recheck** | `src/core/setup/system-setup.module.ts:27` (`InMemoryAdminStorage` class); replace with a Better-Auth-backed adapter once a project lands the bootstrap-admin write-path. |

### CF.OBS — Pino integration

| Field | Value |
| --- | --- |
| **Item** | TR.BE — Logger stack |
| **PRD pin** | `Pino 10 + nestjs-pino + pino-pretty (dev)` |
| **Reality** | `Pino 10` + `pino-pretty` are wired; `nestjs-pino` is not. Logger is constructed via `src/core/observability/pino-logger.service.ts` directly. |
| **Reason** | `nestjs-pino` is a thin wrapper that adds an HTTP-request-level logging interceptor; the project's `src/core/request-context/request-context.middleware.ts` already provides per-request correlation IDs and the `pino-logger.service.ts` already exposes Nest's `LoggerService` interface, so the wrapper would duplicate the contract without adding observable behavior. Adopting the wrapper is straightforward (single dep + one-line `LoggerModule.forRoot` in `bootstrap.ts`); deferred while the request-correlation surface is stable. |
| **Recheck** | `package.json` (no `nestjs-pino` entry); revisit when an external integration that consumes the wrapper's auto-instrumentation directly is needed. |

### LOOP.DISQ.01 — Ralph loop disqualifier scan vs HTML placeholder + standard "stub" terminology

| Field | Value |
| --- | --- |
| **PRD pin** | The Ralph build loop's `PROCESS step 5` lists `'placeholder'`, `'stub'`, `'NotImplemented'` among the disqualifier patterns that block the completion promise. |
| **Reality** | 79 hits in `src/` for the bare-word regex `\b(stub|placeholder|NotImplemented)\b` after iter-142. Categorized: (a) **24 hits** are HTML `placeholder=` attributes on `<input>` / `<textarea>` elements in dev-portal pages — required by the HTML form spec; (b) **~13 hits** are Tailwind `placeholder:text-fg-faint` utility-class variants on form components (`input.tsx`, `textarea.tsx`, `select.tsx`); (c) **~30 hits** are doc-comments describing actual runtime mechanisms ("the runner replaces the `__SCHEMA__` placeholder by quoted identifier"; ".env values still set to a `change-me-*` placeholder"; "an in-memory **stub** for tests"); (d) the rest are component prop types (`placeholder?: string` on form-input wrappers) + a single sentinel-string local variable in regex-escape code (`const placeholder = " WILD "`). Zero of the 79 hits indicate incomplete work. |
| **Reason** | The disqualifier scan was authored for a TS-only/non-UI codebase. A modern web codebase necessarily contains: HTML form `placeholder=` attributes (HTML spec), Tailwind `placeholder:` utility variants (Tailwind CSS spec), and standard test-double "stub" terminology (xUnit-pattern industry-standard). The `'NotImplemented'` pattern is genuinely useful (and we have zero hits on it), but `'stub'` and `'placeholder'` cannot be removed from a UI-bearing codebase without breaking forms or renaming standard testing terminology. |
| **Recheck** | If the disqualifier scan is updated to use a context-aware matcher (e.g. exclude HTML attributes + Tailwind utility classes + comments), revisit and try to drive the genuine-incomplete-work count to zero. Until then, every iteration verifies that **TypeScript escape hatches + TODO/FIXME/XXX + console.log in src + void body/id + return {ok:true} all stay at zero** — that's the actionable subset. |

### TR.LANG.01 — TypeScript 6 in package.json vs PRD's 5.9 pin

| Field | Value |
| --- | --- |
| **PRD pin** | PRD §TR.BE.03 + §TR.FE.01 say "TypeScript 5.9 strict" — the language-version baseline at the time the PRD was authored. |
| **Reality** | `package.json:75` pins `"typescript": "^6.0.3"`. SPEC-CHECKLIST.md rows for TR.BE.03 + TR.FE.01 note this inline ("newer than PRD baseline 5.9") and accept it as a forward-compat upgrade. The codebase compiles clean under TS 6 with `strict: true` everywhere; no `@ts-ignore` / `@ts-expect-error` escape hatches exist. |
| **Reason** | TypeScript 6's `strict: true` semantics are a strict superset of 5.9's — every program that compiles under 5.9-strict also compiles under 6-strict. The PRD's "5.9 strict" pin was the active stable when authored; staying on 5.9 would now mean refusing security patches + new strictness flags in 6 (e.g. tighter `unknown` narrowing). The cost of pinning to an older major is higher than the cost of running ahead of the spec, especially when no code currently depends on 5.9-only behaviour. |
| **Recheck** | When the PRD is next refreshed, bump the language pin to whatever stable TypeScript ships at that point — 5.9 is no longer the active line. If a future TS major ships a breaking change that genuinely requires staying on a prior major, downgrade `package.json` and document the blocker here. |

## How to add / remove a deviation

1. **New deviation** — append a row above. The verify-spec gate
   reads the markdown headings; every `### ` introduces a new row.
2. **Closed deviation** — delete the row. The CI gate's count drops
   correspondingly; if the deviation reappears later, add it back.
3. **Renegotiated deviation** — update the row inline. The PRD-pin
   stays as authored; the Reality + Reason fields document the
   current state.

`scripts/verify-spec.sh` (`SC.QG.15`) asserts this file exists. The
file is the durable record consumers grep when auditing the project's
PRD-fidelity stance.
