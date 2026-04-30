# Avoiding Common Pitfalls

A taxonomised catalogue of every place this codebase will burn you if
you don't know better. Read once, scan again whenever a test fails in
a way that doesn't match the obvious cause.

---

## Module system & imports

### `.js` suffix is mandatory

```typescript
// ✅ correct — runtime resolves .js to the compiled .ts source
import { buildAbility } from "../permissions/casl-ability.js";

// ❌ ERR_MODULE_NOT_FOUND at runtime, even though tsc accepts it
import { buildAbility } from "../permissions/casl-ability";
import { buildAbility } from "../permissions/casl-ability.ts";
```

The repo runs on ESM `nodenext`. Every cross-file import inside the
project needs the `.js` extension.

### Type-only imports

For cycles and tree-shaking:

```typescript
import { type SomeType } from "./foo.js"; // type-only at the import
import type { SomeType } from "./foo.js"; // file-level type-only
```

---

## Feature flags

### `process.env.FEATURE_*` reads are forbidden

`features.ts:loadFeatures()` is the only entry point. Reading the env
var directly bypasses Zod validation, defaults, and the section-key
parser — drift between places is guaranteed.

### Section-key naming bites

The parser splits `FEATURE_<SECTION>_<FIELD>` greedily from the
shortest section. Multi-word section names need an explicit entry in
`SECTION_KEYS`:

```typescript
// FEATURE_POWERSYNC_ENABLED   ← works (POWERSYNC in SECTION_KEYS)
// FEATURE_POWER_SYNC_ENABLED  ← fails — would split as POWER + SYNC_ENABLED
```

If your feature catalog `envKey` doesn't roundtrip via
`loadFeatures({ [envKey]: "true" })`, the regression test in
`tests/stories/feature-catalog.story.test.ts` will tell you.

### Service-status must AND-gate

```typescript
// ❌ shows up even when the feature is off
if (v.POWERSYNC_URL) candidates.push({...})

// ✅ requires both — feature on AND URL set
if (input.features.powerSync.enabled && v.POWERSYNC_URL) candidates.push({...})
```

The URL is "where the container would run", not "is the API using it".

### Catalog entry is mandatory for the UI

The `/dev/features` page reads `FEATURE_CATALOG`. A schema entry
without a catalog entry → no toggle in the UI. Always add both.

---

## Multi-tenancy

### Public routes need exemption

The tenant interceptor enforces `x-tenant-id` on every request that's
not in the exempt list (`src/core/multi-tenancy/tenant-guard.ts`).
Symptom: 400 `CORE_VALIDATION` "Tenant Header Required" on a route
that should be public.

Fix: add the path to `EXEMPT_EXACT` or `EXEMPT_PREFIXES`. Query
strings + fragments are stripped before matching, so `/foo?bar=baz`
resolves correctly.

### Off-by-default for new routes

When you add a new route, decide: tenant-scoped (default) or public
(exempt-list). Auth/health/docs/dev/admin/errors are public.
Everything else needs the header.

---

## Dev runner & feature toggles

### `bun --watch` does not reload `.env`

`bun --watch src/main.ts` reloads source files, but **caches
`process.env` at process start**. So a `.env` edit alone has no
effect.

`scripts/dev.ts` watches `.env` separately and respawns the child
process on change (debounced 200ms). That's how `/dev/features`
toggles take effect.

If you write a tool that edits `.env` outside this watcher, you need
to either invalidate the cached env yourself or signal the dev runner
to respawn.

### Dev-Session lock controls browser auto-open

`scripts/dev.ts` writes `node_modules/.cache/nest-base/dev-session.json`
at startup. `bootstrap.ts` reads it on every NestJS init: first start
of the session ⇒ open browser + hero banner; subsequent re-inits
(bun --watch reload, .env respawn) ⇒ skip browser, render compact
"♻ Server neu gestartet" banner. The lock survives `bun --watch`
re-execs (which would otherwise reset `process.env`). The dev runner
clears the lock on SIGINT/SIGTERM so a fresh `bun run dev` always
cold-starts.

If you write a test that asserts on browser-open behaviour, mock
`transitionDevSession()` from `src/core/dx/dev-session-runner.ts` —
do NOT set `DEV_HUB_OPENED` (legacy, no longer read).

### `DISABLE_PORTLESS=1` for predictable testing

`scripts/dev.ts` probes `127.0.0.1:443` to detect portless. In CI or
when you want deterministic localhost binding: `DISABLE_PORTLESS=1`.

---

## CSP & static assets

### Browser shows blank page on `/api/docs`?

Scalar loads its bundle from `cdn.jsdelivr.net`. If the CSP doesn't
allow that origin, the browser silently blocks the script and the
page renders an empty `<div id="app">`.

Dev CSP whitelists `cdn.jsdelivr.net` (Scalar) and `rsms.me` (Inter
font). See `src/core/http/security-headers.ts:DEV_CSP`. Production
CSP is stricter — assets should be self-hosted in prod.

### Production CSP is intentionally locked down

Don't loosen `PROD_CSP` to "make it work in prod". Self-host the
assets instead.

---

## Prisma 7

### URL is in `prisma.config.ts`, not the schema

Prisma 7 driver-adapter mode keeps the connection URL out of
`schema.prisma`. `prisma studio` cannot discover it from the schema —
the wrapper passes `--url $DATABASE_URL` explicitly.

### CI needs `prisma:generate`

A fresh checkout has no `node_modules/.prisma/client`. Every CI job
that touches Prisma (test:types, test:e2e, test:coverage, build) must
run:

```bash
bun run prepare:schema && bun run prisma:generate
```

Symptom in CI: `Module '"@prisma/client"' has no exported member
'PrismaClient'`. Fix: add the generate step.

### Migrations are forward-only

Per `docs/api-stability-promise.md`, never rewrite an already-shipped
migration. Wrong migration → ship a new one that fixes it.

---

## Tests

### `it.skip` / `xit` is forbidden

If a test is broken, fix the test or fix the code. Skipping it
mortgages future debugging time.

### Coverage drops force more tests

When `bun run test:coverage` fails the gate, the answer is **almost
never** "exclude the file". Excluded already are `*.module.ts`,
`*.controller.ts`, `*.interceptor.ts`, `*.middleware.ts`, `*.guard.ts`,
and `src/core/dx/*-ui.ts` (presentation glue). Anything else needs
real test coverage.

### Story tests live in `tests/stories/`, e2e in `tests/<name>.e2e-spec.ts`

`bun run test:e2e` matches both. `bun run test:unit` matches only
`tests/unit/`. If you create a new story file but the test runner
doesn't pick it up, check the path matches the include glob in
`vitest.config.ts`.

### Testcontainers needs Docker running

`tests/global-setup.ts` boots a Postgres container if `DATABASE_URL`
isn't set. Locally + in CI, Docker must be available. If you run a
test without Docker → setup hangs forever.

---

## Format & lint

### oxfmt rewrites single→double quotes

`bun run format:fix` migrates `'foo'` → `"foo"` on first run. Don't
fight it — use double quotes in new code.

### oxfmt warning is harmless

`No config found, using defaults` exits 0. The "issue" is purely
informational; the format check still works.

### Lint cache invalidation

oxlint is in-memory, no cache file. If lint says "0 warnings" but
something looks wrong, you're probably looking at unsaved changes.

---

## NestJS specifics

### Better-Auth secret reading

`BetterAuthModule` uses a **factory provider**, not `forRoot()`. Why:
`forRoot` evaluates env at module-decoration time (before tests can
set `BETTER_AUTH_SECRET`). The factory reads at provider-init time,
so tests can boot with a freshly-set env var.

### Global interceptors

`OutputPipelineInterceptor` runs on every controller response. If you
write a controller that returns an unusual shape (like a plain string
HTML page), the pipeline still processes it — but for HTML you've
already set `Content-Type: text/html` so the JSON serialiser doesn't
fire.

### Conditional module imports

```typescript
// ✅ zero runtime cost when off
imports: [...conditionalImport(features, "webhooks", WebhooksModule)];

// ❌ module pulled in unconditionally even if disabled
imports: [WebhooksModule];
```

---

## RFC 7807 error responses

### Named sentinel errors get clean status codes

Throwing `new TenantIsolationError("...")` results in 400 + clean
detail. Throwing a generic `Error("...")` results in 500 +
"An unexpected error occurred. Check server logs for details." (the
message is redacted to avoid leaking internal state).

If you want a 4xx client error, **subclass `Error`** with a `name` and
add a branch in `problem-details.filter.ts`.

### `console.error` for unhandled errors

The filter logs unknown errors to `console.error` so they surface in
the dev terminal even though the response body is redacted. Don't
remove this — it's how you debug 500s.

---

## Git workflow

### Don't push --force to main

Period.

### Don't `--no-verify`

Skipping hooks bypasses the lint/format/secrets-scan checks. If a
hook fails, fix the cause.

### Conventional Commits

`feat(<scope>): <message>`, `fix(<scope>): <message>`,
`test(<scope>): <message>`, `docs(<scope>): <message>`,
`chore(<scope>): <message>`. The TDD cycle uses `test(...)` for the
red commit and `feat(...)` for the green commit.

### One change per commit

Each behaviour change ships as a discrete commit pair: one `test(...)`
red, one `feat(...)` green. Combining unrelated changes makes review
and revert harder.

---

## When stuck

1. **Read the failure message twice.** Most pitfalls in this list are
   solved by understanding which layer the error came from.
2. **Look at the closest similar example** in the codebase. The
   conventions are internally consistent — if you're unsure how to
   wire a new feature, find an existing one and copy the pattern.
3. **Check `OPEN_QUESTIONS.md`.** Known design divergences and their
   rationale are documented there.
4. **Ask the user.** Better to clarify than to commit a fix to the
   wrong root cause.
