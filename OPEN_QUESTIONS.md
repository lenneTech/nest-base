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
- **Status:** open (no production wiring exists yet; safe to defer).

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
- **Status:** open.

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
