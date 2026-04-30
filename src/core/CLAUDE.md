# CLAUDE.md — `src/core/`

This is the **template-owned** half of the source tree. Code here syncs
across every project that consumes the template. The boundary is hard
— `bun run sync:from-template` overwrites this folder; `src/modules/` is
guaranteed untouched.

## What lives here

Each subfolder is a self-contained core module. The list (36 folders)
maps to the modules described in
[`docs/architecture.md`](../../docs/architecture.md):

```
app/             ← root NestJS app + bootstrap
audit/           ← encryption-aware audit-log builder
auth/            ← Better-Auth factory + plugin wiring
branding/        ← BrandConfig schema + loader + CSS-var generator + default
concurrency/     ← ETag + If-Match optimistic-concurrency primitives
config/          ← env validation, base-url + cookie + cors config
dev/             ← (reserved — no current files)
dx/              ← /dev landing page + /admin/* HTML renderers + diagnostics
email/           ← EmailService (Nodemailer + Brevo) + EJS-subset templates
encryption/      ← AES-256-GCM field-level encryption with KEK rotation
errors/          ← CORE_* error codes + RFC 7807 problem-details + registry
features/        ← FeaturesSchema (Zod) — single source of truth for toggles
files/           ← TUS uploads + S3/local/postgres storage adapters + assets
gdpr/            ← /me/export builder + /me/account erasure planner
health/          ← /health/live + /health/ready
http/            ← cookie/CORS config, request-context middleware
idempotency/     ← Stripe-style Idempotency-Key service (sha256 fingerprint)
jobs/            ← in-memory job queue + scheduled-job decorator surface
mcp/             ← Model Context Protocol server + decorators + auth guard
multi-tenancy/   ← tenant guard + RLS helpers
observability/   ← OpenTelemetry + Pino setup + traceparent middleware
outbox/          ← OutboxRecorder + OutboxWorker (at-least-once dispatch)
output-pipeline/ ← 4-stage CASL→fields→remove-secrets→safety-net
pagination/      ← cursor + page-limit primitives
permissions/     ← CASL ability + DB-rule resolver + filter service +
                   permission report + permission-test endpoint
prisma/          ← PrismaService + driver-adapter wiring
realtime/        ← LISTEN/NOTIFY service + Socket.IO gateway + channel-filter
repository/      ← BaseRepository + soft-delete extension + UUID v7
request-context/ ← AsyncLocalStorage middleware
search/          ← FTS query parser + cross-resource search + searchable
                   decorator
server/          ← Better-Auth REST adapter mount
setup/           ← schema-concat + setup-wizard + sync-from/to-template
                   planners
testing/         ← (reserved — test helpers may land here)
throttler/       ← Postgres throttler store + multi-window decision
uuid/            ← UUID v7 generator + monotonic guarantees
validation/      ← Zod-based map-and-validate pipe
webhooks/        ← HMAC signature + retry-policy + dispatcher + fanout
```

## Conventions

### Pure-planner / thin-runner split

Every helper that touches I/O is split:

- **Planner** — pure function. No `fs`, no `node:net`, no `process`.
  Inputs are explicit. Tests run without Docker.
- **Runner** — thin glue. Reads files, runs container starts, calls the
  planner, applies the result.

Examples: `src/core/setup/sync-from-template.ts` (planner) +
`scripts/sync-from-template.ts` (runner). `src/core/throttler/throttler.ts`
(planner; takes a `now: () => number`) + Postgres adapter (runner).

If you add a new helper, **start with the planner**. The runner is a
final thin wrapper.

### Error sentinels

Every public function that can fail in a user-distinguishable way throws
a _named_ error class, not a bare `Error`. Examples:
`HandshakeFailedError`, `IdempotencyConflictError`,
`ETagPreconditionFailedError`, `ScalarSpecRequiredError`.

The exception filter in `errors/problem-details.filter.ts` maps known
sentinels to RFC 7807 responses; unknown errors get `CORE_INTERNAL` with
the message redacted in production.

### Imports use `.js` extensions

Even when the source is `foo.ts`. This is ESM `nodenext`; the runtime
resolves `.js` to the compiled (or Bun-handled) source.

```typescript
// ✅
import { buildAbility } from "../permissions/casl-ability.js";

// ❌
import { buildAbility } from "../permissions/casl-ability";
import { buildAbility } from "../permissions/casl-ability.ts";
```

### Coverage threshold

`src/core/` is gated at **≥ 90 % line coverage**. New code without a
test will lower the average and fail CI. Write the story first.

### `features.ts` gating

Don't hard-code `if (env.WEBHOOKS_ENABLED) ...`. Use the parsed
`FeaturesSchema` object so behaviour is consistent across the app:

```typescript
if (features.webhooks.enabled) {
  // wire the dispatcher
}
```

### HTML renderers

Every `/admin/*` and `/dev/*` page renderer in `dx/` HTML-escapes
user-controlled fragments via the standard five-char table:

```typescript
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

The Search-Tester is the only renderer that trusts a payload fragment
(`ts_headline`'s `<b>` tags) — and it documents that explicitly.

## Don't add here

- **Project-specific domain code** — that goes in `src/modules/`.
- **One-off scripts** — `scripts/` for build-time, package.json scripts
  for runtime entry points.
- **Test helpers** — `tests/lib/` for shared test infrastructure.

## Pulling upstream changes

Every change here ships to consumers via `bun run sync:from-template`
on their side. That means:

- **Breaking changes** require a deprecation window (see
  `docs/api-stability-promise.md`).
- **Generic improvements made in a project** should flow back via
  `bun run sync:to-template` + a PR. See
  `docs/core-contribution-guide.md`.

## When you touch a file here

Ask: would this make sense to ship to _every_ project consuming the
template? If not, it belongs in `src/modules/`. If yes, write the story
first, then the code, and run all six gates before committing.
