# CLAUDE.md — agent guide for nest-server-template

This file orients an AI agent (or any new contributor) inside the repo. Read
it first; it should answer "where do I find X" and "what's the convention
for Y" without spelunking through 80+ files.

## What this repo is

A **template-shaped NestJS server** built on Bun + Prisma + Postgres + Better-Auth.
Many projects share the same `src/core/` and add their own resources in
`src/modules/`. The full spec lives in [`PLAN.md`](./PLAN.md); the human
quick-start in [`README.md`](./README.md).

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
decorator, `process()`-style raw pipelines. See PLAN.md §1.4 for context.

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

The project follows **strict red-green-refactor TDD** under the Ralph-Loop
plugin (`.claude/settings.json` has it enabled). Every checklist item in
PLAN.md §32 is one *slice*; one slice = one iteration = one commit each
for tests, impl, and log. The discipline is non-negotiable:

1. **Red** — write the failing story / e2e test first
   (`tests/stories/<feature>.story.test.ts` or `tests/<feature>.e2e-spec.ts`).
   Verify red with `bun run test:e2e <path>`. Commit
   `test(<scope>): add red tests for <slice>`.
2. **Green** — write the minimal code under `src/core/` or `src/modules/`
   until the test passes. No extras, no anticipatory refactors.
3. **Refactor** — clean up without changing behaviour. Tests stay green.
4. **Quality gates** — all six must pass before commit:
   ```bash
   bun run lint && bun run test:unit && bun run test:e2e \
     && bun run test:types && bun run test:coverage && bun run build
   ```
   Coverage thresholds: `src/core/` ≥ 90 %, `src/modules/` ≥ 80 %.
5. **Mark done** — `[ ]` → `[x]` in PLAN.md §32.
6. **Commit** — Conventional Commits: `feat(<scope>): <slice>` /
   `fix(<scope>): <slice>`.

Forbidden:
- `it.skip` / `xit` / `--no-verify` / `--force` / coverage drops
- Implementation without a prior failing test
- Features / refactors / helpers outside PLAN.md
- Editing PLAN.md beyond the checkbox flip

If a slice is unclear, log it in `OPEN_QUESTIONS.md` and pick the next
independent slice. Don't loop on a stuck question.

## Common tasks (links to skills)

These are the recurring workflows; each has a step-by-step skill in
`.claude/skills/`:

| Task | Skill |
|---|---|
| Implement one PLAN.md §32 slice | [`running-tdd-slice`](./.claude/skills/running-tdd-slice.md) |
| Add a project resource | [`adding-feature-module`](./.claude/skills/adding-feature-module.md) |
| Wire permissions on a handler | [`wiring-permissions`](./.claude/skills/wiring-permissions.md) |
| Add a feature flag | [`adding-feature-flag`](./.claude/skills/adding-feature-flag.md) |
| Update from upstream template | [`syncing-from-template`](./.claude/skills/syncing-from-template.md) |

For larger workflows, use the agents in `.claude/agents/`:

- `slice-implementer` — runs the full Ralph red-green-refactor cycle
- `quality-gate-runner` — runs all six gates and produces a remediation report
- `module-scaffolder` — scaffolds a new `src/modules/<name>/` subtree

## Conventions a quick scan won't catch

- **Path imports** — TypeScript modules import each other with the `.js`
  extension (ESM). `import { X } from '../foo.js'` is correct even when the
  source file is `foo.ts`.
- **`fields=[]` on permissions** — currently treated as "no field
  restriction" (laxer than the PLAN.md §6.3 strict reading); see
  `OPEN_QUESTIONS.md`.
- **`features.ts` is the SoT** — every conditional module reads
  `FeaturesSchema.parse(...)`. Never hard-code feature toggles.
- **Pure planners over runners** — every `dx/`, `setup/`, error/audit
  helper splits into a pure planner (testable) + thin runner (I/O). When
  you add a new helper, follow this split.
- **HTML renderers escape everything** — all `/admin/*` and `/dev/*` page
  renderers HTML-escape user-controlled values via the standard 5-char
  table. The Search-Tester is the only renderer that trusts a payload
  fragment (`ts_headline`'s `<b>` tags).
- **PLAN.md is read-only** — only the checkbox flip is allowed. If the
  spec needs to change, that's a user decision documented in
  `RALPH_DIRECTIVES.md` overrides.

## Where to find things

- **Architecture overview** — `PLAN.md` §3 ("Modul-Übersicht")
- **Tech stack rationale** — `PLAN.md` §2
- **Permission model** — `PLAN.md` §6 + `src/core/permissions/`
- **Output pipeline (4 stages)** — `PLAN.md` §7 + `src/core/output-pipeline/`
- **Feature flags** — `src/core/features/features.ts`
- **Error codes** — `src/core/errors/error-code.ts` +
  `src/core/errors/error-code-registry.ts`
- **Webhook contract** — `docs/webhook-spec.md` + `src/core/webhooks/`
- **Realtime** — `src/core/realtime/`
- **MCP** — `src/core/mcp/`

## Quality bar

- Bun-only commands; never shell out to `node`/`npm` from scripts
- Strict TypeScript, no implicit `any`, no `@ts-ignore`
- Comments explain *why*, not *what* (well-named code carries the *what*)
- HTML-escape every user-controlled string in renderers
- Defense-in-depth on file-system / permission / sync surfaces — every
  `src/modules/`-touching path validates the input twice (planner +
  runner)

## When in doubt

Read PLAN.md for the spec, RALPH_LOG.md for what's been built, and
OPEN_QUESTIONS.md for known divergences. The git history is the third
source of truth — every commit is one slice with a written rationale.
