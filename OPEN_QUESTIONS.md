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

### 2026-05-13 · Tests · Redis-backed path coverage gap

- **Context:** `tests/stories/redis-module.story.test.ts` only tests the
  no-Redis fallback path. The Redis-backed paths for `RedisPermissionCache`,
  `RedisRecipientRateLimiter`, and `RedisNewDeviceThrottle` have no automated
  test coverage at all.
- **Question:** should we add a Testcontainers-backed integration test suite
  for these Redis adapters, or is manual QA (with `REDIS_URL` set) sufficient?
- **Working assumption:** manual QA for now. A future slice can add a
  `tests/stories/redis-module.integration.story.test.ts` that starts a Redis
  testcontainer (similar to `global-setup.ts` for Postgres) and exercises the
  live paths.
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
