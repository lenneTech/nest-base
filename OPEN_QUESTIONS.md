# Open Questions

Capture-and-answer log for design decisions that are blocked on a human
call, plus known divergences between the documented behaviour and the
implementation. Anyone (human or AI agent) can append an entry; the
project owner reviews and answers.

## Open

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
