# Open Questions

Capture-and-answer log for design decisions that are blocked on a human
call, plus known divergences between the documented behaviour and the
implementation. Anyone (human or AI agent) can append an entry; the
project owner reviews and answers.

## Open

### 2026-05-13 · Redis · `RedisPermissionCache.invalidateAll()` is a no-op

- **Context:** `createRedisPermissionCache` in `src/core/redis/redis-permission-cache.ts` is not
  wired into `PermissionService` yet — it was added as an infrastructure building block. Its
  `invalidateAll()` method is currently a no-op: calling it does NOT flush permission cache entries
  from Redis, so a global permission change (e.g. a role revoked for all users) would remain cached
  for up to the TTL window (default 30 s) on a Redis-backed deployment.
- **Why it's acceptable now:** `createRedisPermissionCache` has no production consumers. The
  `PermissionService` still uses the original in-memory Map where `invalidateAll()` does call
  `map.clear()` correctly. The no-op only becomes a bug once the Redis adapter is wired in.
- **Correct fix when wiring Redis cache:** implement `invalidateAll()` using one of:
  a) `SCAN 0 MATCH lt:perm:* COUNT 100` loop + `DEL` (O(N) keys, brief Redis pause acceptable at
     small key counts), or
  b) a dedicated Pub/Sub channel (`lt:perm:invalidate`) that each pod subscribes to; on message,
     flush the local in-memory fallback map and optionally issue a SCAN+DEL.
  Do NOT use `FLUSHDB` — it would wipe unrelated Redis data.
- **Status:** fixed (2026-05-13) — `invalidateAll()` now uses SCAN+DEL via ioredis `scanStream()`
  with a manual cursor-loop fallback. Live path coverage is tracked under the existing
  "Tests · Redis-backed path coverage gap (Fix #11)" entry below.

### 2026-05-13 · Jobs · Multi-pod duplicate execution of `setInterval`-scheduled jobs

- **Context:** `ScheduledJobBullMQAdapter` schedules jobs via `setInterval` at
  `OnApplicationBootstrap`. In a multi-replica deployment every pod fires the same interval,
  causing GDPR erasure runs, API-key expiry sweeps, and other scheduled jobs to execute N times
  per interval (once per pod).
- **Why it's acceptable now:** Each scheduled-job runner is idempotent — GDPR erasure checks
  `completed_at`, API-key expiry checks current timestamps, cleanup crons use `deleteMany` with
  time filters. Duplicate executions produce the same outcome; they only waste DB round-trips.
- **Planned fix:** Replace `setInterval`-driven enqueue with BullMQ native repeatable jobs
  (`repeat: { every: ms }` with a stable `jobId`). BullMQ deduplicates via the jobId across
  replicas so exactly one replica enqueues per interval. The `bullmq-cleanup-job-planner.ts` file
  contains the design sketch for this migration.
- **Status:** open (acceptable for single-pod deploys; must be fixed before horizontal scaling).

### 2026-05-13 · Tests · Redis-backed path coverage gap (Fix #11)

- **Context:** `tests/stories/redis-module.story.test.ts` only tests the
  no-Redis fallback path. The Redis-backed live paths for
  `RedisPermissionCache`, `RedisRecipientRateLimiter`, and
  `RedisNewDeviceThrottle` have no automated test coverage at all. The CI
  pipeline (`.github/workflows/ci.yml`) does NOT spin up a Redis service
  container, so even if tests were written they would not run against a real
  ioredis client in CI.
- **What is needed to close this gap:**
  1. Add a Redis service container to `.github/workflows/ci.yml`:
     ```yaml
     services:
       redis:
         image: redis:7-alpine
         ports: ["6379:6379"]
         options: >-
           --health-cmd "redis-cli ping"
           --health-interval 10s
           --health-timeout 5s
           --health-retries 5
     ```
     Then set `TEST_REDIS_URL: redis://localhost:6379` in the CI env.
  2. Add `tests/stories/redis-adapters.integration.story.test.ts` that
     creates a live ioredis client (via `resolveRedisClient(TEST_REDIS_URL)`)
     and exercises `RedisPermissionCache`, `RedisRecipientRateLimiter`, and
     `RedisNewDeviceThrottle` end-to-end — including TTL expiry and
     `invalidateAll()`.
- **Working assumption:** manual QA for now (developer runs with `REDIS_URL`
  set). The no-op `invalidateAll()` on `RedisPermissionCache` is separately
  tracked above.
- **Status:** open.

### 2026-05-13 · Jobs · Daily cron semantic gap: `parseCronToIntervalMs` tracks period, not next-fire

- **Context:** `parseCronToIntervalMs` in `scheduled-job-bullmq-adapter.ts` converts
  `"0 8 * * *"` (daily at 08:00) to `24 * 60 * 60 * 1000` ms. `setInterval` is then
  used to fire the job every 24h. This means the interval is always 24h from the
  *last execution*, not from the *next cron fire time*. If the server boots at 09:00
  with a `"30 23 * * *"` cron, the first fire happens ~24h after boot (next day 09:00),
  not at 23:30 tonight. Real cron daemons fire at the specified wall-clock time.
- **Why it's acceptable now:** All scheduled jobs (GDPR erasure, API-key expiry,
  verification cleanup) are idempotent and time-insensitive within a 24h window. A
  few hours of drift on first-boot execution is invisible to users.
- **Planned fix:** Replace `setInterval` with BullMQ native repeatable jobs
  (`repeat: { pattern: cronExpression }`) which respect the cron fire time. This
  is the same migration tracked in the multi-pod duplicate execution question above.
- **Status:** open (documented; not fixing in this slice).

### 2026-05-13 · Jobs · `bullmq-cleanup-job-planner.ts` is not yet wired

- **Context:** `src/core/jobs/bullmq-cleanup-job-planner.ts` is a pure planner
  that produces BullMQ repeat-job plans for the four cleanup kinds (throttler,
  idempotency, verification, geoip). The TODO comment at line 15 of that file
  states it is not yet wired into any running code — the plans are never
  consumed. Consequently the cleanup jobs are not scheduled via BullMQ native
  repeatable jobs; the current `ScheduledJobBullMQAdapter` uses `setInterval`
  instead (which does not deduplicate across replicas).
- **What is needed to activate it:** call `buildBullMQCleanupJobPlan` for each
  `CleanupKind` inside `JobsModule.onApplicationBootstrap` (or a dedicated
  module lifecycle hook) and register the resulting plan with
  `BullMQJobQueue.register()` using `repeat: { pattern: plan.repeatPattern }`
  and `jobId: plan.jobId` in the BullMQ Queue options. This replaces the
  `setInterval`-based scheduling and provides cross-replica deduplication.
- **Status:** open (acceptable until horizontal scaling is needed; tracked
  together with the multi-pod duplicate execution question above).

### 2026-05-13 · Realtime · Anonymous auth-handshake in Socket.IO gateway

- **Context:** `src/core/realtime/realtime.module.ts` — the `handleConnection`
  hook in `RealtimeGateway` currently tags every connecting socket as
  `userId: "anonymous"` / `tenantId: "anonymous"`. No session token validation
  or Better-Auth lookup is performed at connection time.
- **Question:** is "anonymous mode acceptable for the current release scope",
  or should the production auth-handshake be wired before launch?
- **Working assumption:** anonymous mode is acceptable while the feature is in
  internal development. The gateway rejects unauthorised *channel subscriptions*
  via `canSubscribeToChannel` once the handshake resolver is wired. Until then
  every channel is accessible to every client — not safe for production without
  network-level perimeter controls (VPN / API gateway JWT validation).
- **Correct fix when wiring:** validate the `auth.token` field from the
  Socket.IO handshake against Better-Auth's session API (or JWT) inside
  `handleConnection`, resolve `userId`/`tenantId`, and reject the socket on
  failure. See `src/core/realtime/realtime.module.ts` line ~140 and
  `canSubscribeToChannel` in `channel-permission.ts`.
- **Status:** fixed (2026-05-13) — Fix 1.2 wires the BetterAuth session lookup
  in `handleConnection` via `authenticateConnection()`. Unauthenticated sockets
  are disconnected. When `auth` is null (BETTER_AUTH_SECRET not set) the gateway
  falls back to anonymous mode with a warning log. CASL ability resolution for
  per-channel subscription gating is still pending (noted as a TODO in the code).

### 2026-05-13 · OutputPipeline · Stage 1+2 CASL enforcement gap (Fix 2.4)

- **Context:** The 4-stage output pipeline runs via `OutputPipelineInterceptor`.
  However, several controllers (especially `FileController`, `FolderController`,
  `GdprController`) return Prisma results directly without calling
  `OutputPipeline.run()` with a CASL ability — Stage 1+2 field filtering is
  bypassed for those routes.
- **Why it's acceptable now:** Stages 3+4 (`removeSecrets`, safety-net) still
  run for all intercepted endpoints. The CASL field filter (Stages 1+2) adds
  fine-grained per-field access control; without it the worst case is that a
  user sees fields their role technically doesn't have `read` permission for.
  The broader `@Can()` guard still gates the entire action.
- **Planned fix:** wire `OutputPipeline.run(ability, subject, value)` in every
  controller endpoint that returns entity objects. This requires resolving the
  CASL ability inside the handler (inject `PermissionService`, call
  `getAbility(userId, tenantId)`). An interceptor-level fix would inject the
  ability once per request and run the pipeline transparently — preferred over
  per-handler wiring.
- **Status:** open (deferred; invasive change requiring permission-service wiring
  in all affected controllers).

### 2026-05-13 · Files · tenantId from query-param in FileController/FolderController (Fix 2.5)

- **Context:** `GET /files?tenantId=<id>` and `GET /folders?tenantId=<id>` accept
  the tenant via a query parameter. The `TenantInterceptor` normally reads
  `x-tenant-id` from headers and populates the AsyncLocalStorage context. For
  these endpoints the query param bypasses the standard interceptor path.
- **Why it's acceptable now:** The CASL `@Can("read", "File")` gate and
  service-layer Prisma queries both filter by `tenantId` explicitly. The RLS
  policy is the last-resort backstop.
- **Planned fix:** remove the `?tenantId=` query param pattern from
  `FileController` and `FolderController` and require the standard
  `x-tenant-id` header so the TenantInterceptor sets the RLS context before
  any query runs. This is a breaking API change — existing callers must be
  updated.
- **Status:** open (deferred; breaking change requiring client migration).

### 2026-05-13 · Realtime · `OUTBOX_DISPATCHERS` push()-mutation vs. useFactory (Fix 4.2)

- **Context:** Code-review finding Fix 4.2 suggests replacing the `dispatchers.push(new RealtimeOutboxDispatcher(gateway))` call in `RealtimeOutboxDispatcherLifecycle.onModuleInit()` with a `useFactory` provider for `OUTBOX_DISPATCHERS` in `RealtimeModule`. However, `OutboxModule` exports `OUTBOX_DISPATCHERS` as a shared singleton `useValue: []` array, and `OutboxWorkerLifecycle` holds a direct reference to that same array object. A `useFactory` override on `OUTBOX_DISPATCHERS` inside `RealtimeModule` would only rebind the token within `RealtimeModule`'s DI scope — the `OutboxWorker` inside `OutboxModule` would still see the original empty array, so dispatchers would never be invoked.
- **Why push() is correct:** The mutation on the shared array reference is the only way to make dispatchers visible to the `OutboxWorker`. The deduplication guard (`dispatchers.some(d => d.name === "realtime-outbox")`) prevents double-registration on hot-reload. `WebhooksModule` uses the same pattern.
- **Correct fix (requires architecture change):** Migrate `OUTBOX_DISPATCHERS` from `useValue: []` to a NestJS `useFactory` that collects dispatchers via a multi-provider token, then re-exports the composed array. This requires changes to `OutboxModule`, `RealtimeModule`, `WebhooksModule` simultaneously to keep the integration consistent.
- **Status:** open (deferred; push()-mutation is safe with the deduplication guard).

### 2026-05-13 · Outbox · Multi-pod seq collision in `OutboxRecorder`

- **Context:** `OutboxRecorder` seeds its `seq` counter at startup using
  `MAX(seq)` from the `outbox_entries` table. When two pods boot simultaneously
  (e.g. during a rolling deploy) both see the same `MAX(seq)` value as their
  starting point. The first few entries written by both pods will carry
  duplicate `seq` values; the per-second worker processes them in
  non-deterministic order until the two counters diverge naturally.
- **Why it's acceptable now:** `seq` is used for ordering within a single
  pod's claim batch — duplicate seq values across pods cause entries to be
  processed out of strict global order for at most a few seconds at startup.
  The at-least-once dispatch guarantee is unaffected (entries still get
  processed; `processedAt` is set after success). No data loss occurs.
- **Correct fix:** change `seq` to a Postgres `BIGSERIAL` column with
  DB-side auto-increment instead of App-side counter. This shifts the
  monotonic guarantee to the DB layer and eliminates the TOCTOU window
  entirely. Migration: `ALTER TABLE outbox_entries ALTER COLUMN seq SET DEFAULT nextval('<seq_name>')`.
- **Status:** open (acceptable until multi-pod horizontal scaling is needed).

### 2026-05-13 · Jobs/Observability · Business metrics not instrumented in BullMQ and Outbox

- **Context:** Code-review finding MIN-5 requests `MetricsService.counter()`
  instrumentation in `BullMQJobQueue` (jobs_enqueued_total,
  jobs_completed_total, jobs_failed_total) and `OutboxWorker`
  (outbox_dispatched_total, outbox_dead_lettered_total).
- **Why deferred:** `MetricsService` is provided by `MetricsModule`, which is
  conditionally loaded via `features.observability.enabled`. `BullMQJobQueue`
  is a plain class (not a NestJS injectable); `JobQueueService` extends it and
  IS a NestJS provider in `JobsModule`, but `JobsModule` does not import
  `MetricsModule`. `OutboxWorker` is similarly a plain class instantiated by
  `OutboxModule`. Adding the instrumentation requires either:
  a) Making `MetricsModule` `@Global()` so every module can inject
     `MetricsService` without an explicit import, or
  b) Introducing an `@Optional()` `MetricsService` parameter into
     `JobQueueService` and `OutboxModule`, with `JobsModule` and `OutboxModule`
     importing `MetricsModule` (or adding a forward reference).
  Both approaches need a design decision before implementation to avoid
  circular-module issues.
- **Correct fix when wiring:** prefer option (a) — mark `MetricsModule`
  `@Global()` so the `MetricsService` token is available everywhere without
  per-module imports. Then add `@Optional() private readonly metrics?: MetricsService`
  to `JobQueueService` and wire the counters in `enqueue()`, the worker
  `completed`/`failed` callbacks, and `OutboxWorker.runOnce()`.
- **Status:** open (no instrumentation exists today; safe to defer until
  observability is a hard requirement).

<!--
Per entry:

### YYYY-MM-DD · <area> · <short title>
- **Context:** what was attempted, where the spec is.
- **Question:** the specific decision needed.
- **Working assumption:** what the agent does in the meantime.
- **Status:** open | answered (date + decision)
-->

## Answered

### 2026-04-28 · Permissions · `Permission.fields = []` semantics

- **Context:** the original spec read `fields String[]` with
  "null = all fields, [] = no fields". The Postgres schema uses a
  non-null array, and CASL itself rejects an empty `fields` array on
  a rule (`rawRule.fields cannot be an empty array`).
- **Question:** how should `fields = []` behave at the CASL layer?
- **Answer (2026-04-28):** `[]` means "no field-level restriction"
  (matching the prior null semantics). Rationale: CASL can't represent
  the original "deny every field" interpretation in a single rule, and
  the implementation already treats empty arrays as wide-open. The
  intended deny-all case is expressed by simply not granting the
  action (or via an inverted rule). See `docs/architecture.md`
  "Permission model" for the current behaviour.
- **Status:** answered.
