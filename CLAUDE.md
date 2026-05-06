# CLAUDE.md — agent guide for nest-base

This file orients an AI agent (or any new contributor) inside the repo. Read
it first; it should answer "where do I find X" and "what's the convention
for Y" without spelunking through 80+ files.

> **Just opened the repo?** Start with [`.claude/QUICKSTART.md`](./.claude/QUICKSTART.md)
> for a 60-second onboarding card, then come back here for the deeper tour.
> The full agent / skill / command catalogue is in [`.claude/AGENTS.md`](./.claude/AGENTS.md).

## What this repo is

A **template-shaped NestJS server** built on Bun + Prisma + Postgres + Better-Auth.
Many projects share the same `src/core/` and add their own resources in
`src/modules/`.

- Architecture & subsystems → [`docs/architecture.md`](./docs/architecture.md)
- Coding conventions → [`docs/code-guidelines.md`](./docs/code-guidelines.md)
- Contribution workflow → [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Initialisation history → [`docs/initialisation-history.md`](./docs/initialisation-history.md)
- Human quick-start → [`README.md`](./README.md)

| Aspect | Choice |
|---|---|
| Runtime | Bun 1.x (Node 22 fallback) |
| Framework | NestJS 11 |
| ORM | Prisma 7 (driver-adapter mode) |
| DB | Postgres 18 |
| Auth | Better-Auth 1.6 |
| Validation | Zod 4 |
| Tests | Vitest 4 |
| Lint/Format | oxlint / oxfmt |
| API style | REST + OpenAPI 3.1 + Scalar UI |
| License | MIT |

Out-of-scope features (don't add): GraphQL, MongoDB / Mongoose, Vendor-Mode,
Mailjet, the legacy `@Restricted`/`@Roles` stack, the `@UnifiedField`
decorator, `process()`-style raw pipelines. See
[`docs/architecture.md`](./docs/architecture.md) "Out of scope" for the
rationale.

## Repo layout

```
src/
├── core/          ← Template-owned. Synced via `bun run sync:from-template`.
├── modules/       ← Project-owned. Add your domain code here.
└── shared/        ← Cross-tier types (channels, event payloads, SDK seeds).
tests/
├── stories/       ← TDD story tests, one file per surface. RED-first.
├── unit/          ← Pure-function tests.
├── types/         ← `tsc --noEmit` compile-tests via tsconfig.json.
└── *.e2e-spec.ts  ← End-to-end specs running through the HTTP layer.
prisma/
├── schema.prisma  ← Core schema (always present).
└── features/      ← Feature-gated schemas; concat'd by `bun run prepare:schema`.
docs/              ← Six guides (template-update, customization, contributor,
                     consumer, api-stability-promise, webhook-spec).
scripts/           ← `dev.ts`, `build.ts`, setup-wizard runner, sync helpers.
.claude/           ← Agents + skills + plugin config for Claude Code.
.vscode/           ← Workspace defaults (oxc as default formatter).
```

Per-folder navigation guides live in `src/core/CLAUDE.md`, `src/modules/CLAUDE.md`,
`tests/CLAUDE.md`, `prisma/CLAUDE.md`. Read those when you enter a folder.

## How development happens (TDD discipline)

The project follows **strict red-green-refactor TDD**. The discipline
is non-negotiable:

1. **Red** — write the failing story / e2e test first
   (`tests/stories/<feature>.story.test.ts` or `tests/<feature>.e2e-spec.ts`).
   Verify red with `bun run test:e2e <path>`. Commit
   `test(<scope>): add red tests for <change>`.
2. **Green** — write the minimal code under `src/core/` or `src/modules/`
   until the test passes. No extras, no anticipatory refactors.
3. **Refactor** — clean up without changing behaviour. Tests stay green.
4. **Quality gates** — all six must pass before commit:
   ```bash
   bun run lint && bun run test:unit && bun run test:e2e \
     && bun run test:types && bun run test:coverage && bun run build
   ```
   Coverage thresholds: `src/core/` ≥ 80 %, `src/modules/` ≥ 75 %
   (`nest-base-prd.md` § Quality Gates; enforced by
   `scripts/check-coverage-thresholds.ts`).
5. **Commit** — Conventional Commits: `feat(<scope>): <summary>` /
   `fix(<scope>): <summary>`.

Forbidden:
- `it.skip` / `xit` / `--no-verify` / `--force` / coverage drops
- Implementation without a prior failing test

If something is unclear, log it in `OPEN_QUESTIONS.md` and pick the next
independent piece of work. Don't loop on a stuck question.

## Common tasks (links to skills)

These are the recurring workflows; each has a step-by-step skill in
`.claude/skills/`:

| Task | Skill |
|---|---|
| Run one TDD red-green-refactor cycle | [`running-tdd-slice`](./.claude/skills/running-tdd-slice.md) |
| Add a project resource | [`adding-feature-module`](./.claude/skills/adding-feature-module.md) |
| Wire permissions on a handler | [`wiring-permissions`](./.claude/skills/wiring-permissions.md) |
| Add a feature flag | [`adding-feature-flag`](./.claude/skills/adding-feature-flag.md) |
| Add a new error code | [`adding-error-code`](./.claude/skills/adding-error-code.md) |
| Add a new Hub or admin page | [`extending-hub`](./.claude/skills/extending-hub.md) |
| Update from upstream template | [`syncing-from-template`](./.claude/skills/syncing-from-template.md) |
| PR a `src/core/` fix back upstream | [`contributing-upstream`](./.claude/skills/contributing-upstream.md) + `/upstream-pr` |

For larger workflows, use the agents in `.claude/agents/`:

- `quality-gate-runner` — runs all six gates and produces a remediation report
- `module-scaffolder` — scaffolds a new `src/modules/<name>/` subtree
- `feature-toggle-implementer` — wires a new feature flag end-to-end (schema → catalog → tests → live)

For the user, the slash command [`/add-feature <key> "<description>"`](./.claude/commands/add-feature.md) sequences the feature-flag workflow under TDD discipline.

**Full agent / skill / command index**: [`.claude/AGENTS.md`](./.claude/AGENTS.md)

## Conventions a quick scan won't catch

- **Path imports** — TypeScript modules import each other with the `.js`
  extension (ESM). `import { X } from '../foo.js'` is correct even when the
  source file is `foo.ts`.
- **`fields=[]` on permissions** — treated as "no field restriction".
  See `OPEN_QUESTIONS.md` for the rationale (CASL cannot represent
  "deny every field" in a single rule).
- **`features.ts` is the SoT** — every conditional module reads
  `FeaturesSchema.parse(...)`. Never hard-code feature toggles.
- **Pure planners over runners** — every `dx/`, `setup/`, error/audit
  helper splits into a pure planner (testable) + thin runner (I/O). When
  you add a new helper, follow this split.
- **HTML renderers escape everything** — all `/admin/*` and `/hub/*` page
  renderers HTML-escape user-controlled values via the standard 5-char
  table. The Search-Tester is the only renderer that trusts a payload
  fragment (`ts_headline`'s `<b>` tags).
- **The initialisation phase is closed.** Architectural decisions live
  in `docs/architecture.md`, conventions in `docs/code-guidelines.md`,
  the historical phase log in `docs/initialisation-history.md`. New
  work happens against issues, not against a frozen spec.

## Where to find things

- **Architecture overview** — [`docs/architecture.md`](./docs/architecture.md)
- **Coding conventions** — [`docs/code-guidelines.md`](./docs/code-guidelines.md)
- **Permission model** — `docs/architecture.md` "Permission model" + `src/core/permissions/`
- **Output pipeline (4 stages)** — `docs/architecture.md` "Output pipeline" + `src/core/output-pipeline/`
- **Feature flags** — `src/core/features/features.ts`
- **Error codes** — `src/core/errors/error-code.ts` +
  `src/core/errors/error-code-registry.ts`
- **Webhook contract** — `docs/webhook-spec.md` + `src/core/webhooks/`
- **API stability** — `docs/api-stability-promise.md`
- **Realtime** — `src/core/realtime/`
- **MCP** — `src/core/mcp/`

## Route gating policy — every route is gated or @Public()

Every HTTP-handler method on a controller in `src/core/**` and
`src/modules/**` MUST be one of:

1. **Gated** with `@Can(action, subject)` — the default. The handler
   runs only if `CanGuard` resolves a CASL ability that allows the
   action on the subject for the request's `(userId, tenantId)`.

2. **Explicitly public** with `@Public("<one-sentence reason>")` —
   the route is intentionally callable without auth or permissions
   (health checks, SDK-discovery endpoints, public catalogues like
   `/errors`). The reason string is required and shows up in the
   route audit (Issue #47).

3. **Path-allowlisted** in `src/core/auth/jwt-middleware.ts`
   `PUBLIC_PREFIXES`/`PUBLIC_EXACT` and/or
   `src/core/multi-tenancy/tenant-guard.ts` `EXEMPT_*` — for
   subsystem-wide patterns (`/health/*`, `/api/auth/*`, `/api/hub/*`,
   `/me/*`). Adding a path here is a deliberate cross-cutting
   decision; prefer `@Public()` for individual routes.

**No fourth option.** A handler with neither `@Can()` nor `@Public()`
nor a matching allowlist entry is a bug — the build-time gate
(`tests/stories/route-gating-audit.story.test.ts`, planner at
`src/core/permissions/route-audit-planner.ts`) fails CI on this. See
[`docs/security/route-audit-2026-05-02.md`](./docs/security/route-audit-2026-05-02.md)
for the current inventory.

When porting a route or adding a new one:

- If you can't decide between `@Can()` and `@Public()`, default to
  `@Can()` and stop. Pick a CASL subject that already exists or talk
  to the architecture before inventing a new one.
- Never delete `@Can()` "to fix a 403" — fix the policy or the
  storage adapter, not the gate.
- `@Public()` without a reason is a lint error. Don't write
  `@Public("")` or `@Public("public")` — explain *why* ("public OAS
  catalogue for SDK consumers", "health probe for k8s", etc.).

The decorator lives at `src/core/permissions/public.decorator.ts`.
The skill [`wiring-permissions`](./.claude/skills/wiring-permissions.md)
has the decision flow + worked examples.

## Quality bar

- Bun-only commands; never shell out to `node`/`npm` from scripts
- Strict TypeScript, no implicit `any`, no `@ts-ignore`
- Comments explain *why*, not *what* (well-named code carries the *what*)
- HTML-escape every user-controlled string in renderers
- Defense-in-depth on file-system / permission / sync surfaces — every
  `src/modules/`-touching path validates the input twice (planner +
  runner)

## When in doubt

Read [`docs/architecture.md`](./docs/architecture.md) for the structure,
[`docs/code-guidelines.md`](./docs/code-guidelines.md) for the
conventions, `OPEN_QUESTIONS.md` for known divergences. The git history
is the third source of truth — every commit is one slice with a written
rationale.
