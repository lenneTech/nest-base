# LLM-Test 58-failure audit · 2026-04-30

> **Historical note (2026-05-19):** Spec paths below cite `tests/dev-hub.e2e-spec.ts`
> and `/dev/static/*`; the live suite is `tests/hub.e2e-spec.ts` and `/hub/static/*`.

The friction log from the LLM-test run (2026-05-02-18-44-43) reported
`Test Files 12 failed | 233 passed (245)` and
`Tests 58 failed | 2305 passed (2363)` on a fresh
`lt fullstack init --next` workspace.

This audit re-measures the failure surface on `origin/main`
post-#41 + #45 and classifies every remaining failure.

## Re-measurement

Setup:
- worktree `fix/audit-fresh-install-e2e-failures`
- `docker compose up -d postgres` (Postgres 18 + pg_uuidv7)
- `bun run prepare:schema && bun run prisma:generate`
- **No** `bun run build:dev-portal` (simulating the missing 6-gate step)

`bun run test:e2e` baseline: `Test Files 1 failed | 254 passed (255)`,
`Tests 2 failed | 2406 passed (2408)`.

The original 58 failures collapsed to 2. The Wave-A merges
(#41 dev-portal SPA, #42 ResourceNotFoundError, #44 self-service
tenants, #45 PermissionStorage default, #46 prisma client resolver)
already fixed the other 56.

## Failures

| # | Spec | Test | Failing assertion | Class | Resolution |
|---|---|---|---|---|---|
| 1 | `tests/hub.e2e-spec.ts` (was `dev-hub`) | `GET /hub/static/main.js` serves the bundled SPA entry as JavaScript | `expect(404).toBe(200)` | `missing-fixture` | Build the SPA bundle on demand from `tests/global-setup.ts` |
| 2 | `tests/hub.e2e-spec.ts` (was `dev-hub`) | `GET /hub/static/tokens.css` serves the design-token CSS | `expect(404).toBe(200)` | `missing-fixture` | Same fix — `dist/dev-portal/tokens.css` is emitted alongside `main.js` |

### Class breakdown

| Class | Count | Notes |
|---|---|---|
| `pre-existing-bug` | 0 | — |
| `stale-test` | 0 | — |
| `missing-fixture` | 2 | Dev-Portal SPA bundle missing on fresh clones |
| `env-leak` | 0 | (Pre-existing flakiness in `test:coverage` is wave-B's territory and is not introduced by these tests) |
| `flaky-infra` | 0 | — |

## Fix

`tests/global-setup.ts` now builds the Dev-Portal SPA on demand if
`dist/dev-portal/main.js` or `dist/dev-portal/tokens.css` is missing.
The build is idempotent and skipped when both files already exist, so
warm caches pay zero rebuild cost. Fresh installs pay ~1s once.

`tests/stories/test-containers-setup.story.test.ts` pins the new
contract so a future cleanup can't quietly drop the build step.

## Out of scope

`bun run test:coverage` showed 2–3 additional failures
(`tests/health.e2e-spec.ts`, `tests/email-outbox-flow.e2e-spec.ts`,
`tests/webhook-inspector.e2e-spec.ts`) under v8 instrumentation. They
do not appear in `bun run test:e2e` and reproduce on the unmodified
baseline (verified by `git stash && bun run test:coverage`). These are
the wave-B test-infra-cluster's territory (NODE_ENV leak +
shared-DB-under-coverage-load) — not double-fixed here per the audit
brief.
