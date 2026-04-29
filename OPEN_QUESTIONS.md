# Open Questions

Capture-and-answer log for divergences between the spec
([`PLAN.md`](./PLAN.md)) and the implementation, plus open design
decisions that are blocked on a human call. Anyone (human or AI agent)
can append an entry; the project owner reviews and answers.

## Open

_None._

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

- **Context:** PLAN.md §6.3 originally read `fields String[]` with
  "null = all fields, [] = no fields". The Postgres schema uses a
  non-null array, and CASL itself rejects an empty `fields` array on
  a rule (`rawRule.fields cannot be an empty array`).
- **Question:** how should `fields = []` behave at the CASL layer?
- **Answer (2026-04-28):** PLAN.md §6.3 was updated so that `[]` means
  "no field-level restriction" (matching the prior null semantics).
  Rationale: CASL can't represent the original "deny every field"
  interpretation in a single rule, and the implementation already
  treats empty arrays as wide-open. The intended deny-all case is
  expressed by simply not granting the action (or via an inverted
  rule).
- **Status:** answered.


---

### Open question — TODO(perm-gate): @Can() on search/powersync/asset/geo controllers

- **Found in:** intensive review of `/dev/routes` audit (32%
  unguarded). The user-data-touching controllers had no `@Can()`
  decorator, only a `req.user` nullcheck.
- **Done so far:** `gdpr.controller` and `address.controller` are
  fully wired with `@Can()` decorators (story-tested).
- **Blocked on:** the existing e2e suite for `search-controller`,
  `powersync-controller`, `asset.controller`, and `geo.controller`
  posts unauthenticated requests directly. Adding `@Can()` there
  causes those tests to 403 instead of testing the controller logic.
- **Next slice:** add a test-ability helper (e.g. an interceptor that
  honours an `X-Test-Ability: <ability-blob>` header only when
  `NODE_ENV === "test"`) so tests can pre-seed an Ability without
  going through the full Better-Auth flow. Once that lands, finish
  wiring the remaining 4 controllers.
- **Status:** open.
