# API Stability Promise

This document defines what "stable" means for projects consuming the
template. Read it before you depend on a specific symbol from `src/core/`,
and read it again before you build tooling that parses our OpenAPI doc.

## Versioning

The template follows **semver 2.0.0**:

| Bump  | Triggered by |
|-------|--------------|
| **major** | Removed public symbol, changed signature, removed feature flag, schema field rename without migration |
| **minor** | New public symbol, new feature flag (default off), new optional field |
| **patch** | Bug fix that does not change the public surface |

Pre-1.0 the template uses `0.MINOR.PATCH` — until we tag `1.0.0`, every minor
bump may include breaking changes. The migration guide stays mandatory.

## What is the public surface

| Path | Stability | Notes |
|------|-----------|-------|
| `src/core/` (re-exported by `index.ts`) | **public** — semver applies | Anything you `import` from a core barrel file. Internal-only helpers live in `_internal/` sub-folders and are explicitly out of scope. |
| `src/modules/` | project-local — no promise from us | Whatever your project owns. The template never reads from `src/modules/`. |
| `src/shared/` (types, channel names, event payloads) | **public** — semver applies | Shape of cross-tier data. Frontend SDKs ship from here. |
| `prisma/schema.prisma` (field names) | **public** — semver applies | Schema renames bump major. New nullable columns are minor. |
| `prisma/features/*.prisma` | **public** — semver applies | Same rules per feature schema. |
| Generated SDK (`bun run sdk:generate`) | mirrors OpenAPI doc | OpenAPI changes follow the same semver rules. |
| `docs/openapi.snapshot.json` | **public** — mirrors OpenAPI doc | Checked-in snapshot of `/api/openapi.json`. Regenerated via `bun run dump:openapi`; CI fails when it drifts. Frontend consumers can target it directly when the dev API isn't running. |
| `tests/`, `scripts/` | internal | Don't depend on test fixtures or the build script. |

## OpenAPI URLs (canonical vs deprecated)

The OpenAPI document is served at two paths:

| Path | Status | Purpose |
|------|--------|---------|
| `/api/openapi.json` | **canonical** | Use this for SDK generators, frontend `openapi-ts.config.ts`, and any new tooling. |
| `/api-docs-json` | deprecated alias | Older `nuxt-base-starter` workspaces that hard-coded this path. The server returns the same body plus an RFC 8594 `Deprecation` header and an RFC 8288 `Link: rel="successor-version"` pointing at the canonical URL. Tracked at lenneTech/nuxt-base-starter#13 — once that fix has propagated, the alias is removed in a future minor. |

### Offline / fallback type generation

If the dev API isn't running (e.g. the dev runner is down, or you're
working frontend-first against a locked-down CI), point your SDK
generator at the checked-in snapshot instead of a live URL:

```bash
# In the frontend workspace:
openapi-ts --input ../api/docs/openapi.snapshot.json --output app/api-client
```

The snapshot is regenerated via `bun run dump:openapi` (boots NestJS
in-process against a Postgres testcontainer, fetches `/api/openapi.json`,
writes the result). `tests/stories/openapi-snapshot.story.test.ts` fails
CI on drift, so a contributor who adds a route can't ship without
refreshing the file.

## Deprecation window

Every breaking change goes through a **two-minor-version deprecation
window** before removal:

1. Mark the symbol with a `@deprecated` JSDoc tag in the same release that
   ships the replacement. Example: deprecated in `0.7.0`, removed in
   `0.9.0`.
2. The deprecation message names the replacement and the removal version.
3. The migration guide lists every deprecation that fired in the release
   so consumers can grep for `@deprecated` in their codebase before
   upgrading.

In an emergency (security, data-loss bug) we may cut the window short —
the changelog entry says so explicitly and the message includes a
non-mechanical note.

## Migration guides

Every minor / major release that flips a `@deprecated` symbol to "removed"
ships a **migration guide** in the changelog:

- Diff sketches showing the before / after at the call site
- The codemod or sed-script we used to bulk-update the template's own
  consumers (when one exists)
- A pointer at the upstream GitHub discussion / issue for context

If you're tracking the template via `bun run sync:from-template`, the
migration guide is the file to read between the sync and your next
`bun run test:e2e`.

## Behavioural contracts

Beyond named symbols, the following behaviours are stable across patch
releases:

- **HTTP status codes** for documented error conditions (we don't quietly
  upgrade a 400 to a 422)
- **OpenAPI `code` enum** entries (we add codes; we don't repurpose them)
- **Idempotency-Key contract** — same key + same body within TTL replays
  the cached response with `Idempotency-Replay: 1`; same key + different
  body returns `409 Conflict` + `CORE_CONFLICT` + an `idempotencyKey`
  extension on the RFC 7807 body, and the handler is NOT re-invoked
- **ETag concurrency** — `ETag: "vN"` on reads, `If-Match: "vN"` on writes,
  mismatches surface `412 Precondition Failed` + `CORE_PRECONDITION_FAILED`
  with the current ETag echoed on the body
- **Webhook signature scheme** (`t=,v1=` Standard-Webhooks header — see
  [Webhook-Spec](./webhook-spec.md))
- **Database migrations** are forward-only; we never rewrite history of an
  already-shipped migration

## Reporting drift

If you find a symbol that broke without going through this window, file an
issue with the diff and the affected release range — we treat that as a
bug, not a "you should have used the internal API differently" note.
