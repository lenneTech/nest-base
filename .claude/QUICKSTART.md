# `.claude/QUICKSTART.md` — agent onboarding card

You are an AI agent that just opened the **nest-base** repository.
This card gets you productive in 60 seconds. Read it top-to-bottom
**before** you start any task.

## What this repo is

**nest-base** is a production-grade NestJS template on Bun + Prisma 7

- Postgres + Better-Auth. It ships with a developer cockpit at `/dev`
  (dark theme + electric-lime accent, 14 toggleable features, live
  status / coverage / tests / logs / feature toggles). The repo is the
  sync source for `src/core/` — many projects fork off this template.

## The 5 things that shape every decision

1. **`features.ts` is the single source of truth** for which modules
   activate. Never read `process.env.FEATURE_*` directly.
2. **`src/core/` is template-owned**, `src/modules/` is project-owned.
   Sync respects that boundary.
3. **Pure-planner + thin-runner split**. Every helper that touches
   I/O has a pure function (testable without Docker) plus a thin glue
   wrapper that calls it.
4. **TDD-discipline + 6 quality gates** every commit. Red → green →
   refactor, no `it.skip`, no `--no-verify`.
5. **ESM with `.js` import suffix** in TypeScript source. `import
{ x } from "./foo.js"` even when the file is `foo.ts`.

## Boot the project (2 commands)

```bash
docker compose up -d postgres   # boot Postgres only (others optional)
bun run dev                     # auto-spawns Prisma Studio + opens /dev
```

> **Recover from a stale Postgres volume?** `docker compose down -v && docker compose up -d postgres` followed by `bun run prisma:migrate`. Don't delete `.env` first — the existing password initialises the recreated volume.

Server is at the URL the dev runner prints — `https://api.nest-base.localhost`
if you have [portless](https://github.com/portless/portless) installed,
otherwise the bare `http://localhost:<port>` it announces (`:3000` when
free, a dynamic fallback like `:4266` when it isn't). Always trust the
printed URL over a hard-coded `localhost:3000` — concurrent runs and
test suites can shift the port. Dev cockpit at `/dev`.

If `bun install` hasn't run: `bun install && bun run prisma:generate`.

## Where to look first

| Question                  | File                                                                  |
| ------------------------- | --------------------------------------------------------------------- |
| Architecture & subsystems | [`docs/architecture.md`](../docs/architecture.md)                     |
| Coding conventions        | [`docs/code-guidelines.md`](../docs/code-guidelines.md)               |
| Initialisation history    | [`docs/initialisation-history.md`](../docs/initialisation-history.md) |
| What's already built?     | `RALPH_LOG.md`                                                        |
| What's known to diverge?  | `OPEN_QUESTIONS.md`                                                   |
| What tools are available? | [`.claude/AGENTS.md`](AGENTS.md) — master index                       |
| Per-folder conventions    | `src/core/CLAUDE.md`, `tests/CLAUDE.md`, `prisma/CLAUDE.md`           |

## When the user says X, reach for Y

| User intent                    | Primitive                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------- |
| "Add a feature flag"           | `/add-feature` command + `feature-toggle-implementer` agent                     |
| "Add a tenant-scoped module"   | `/add-module` command, `module-scaffolder` agent, or `bun run add:module <name>` |
| "Add an admin/dev page"        | `/add-page` command + skill `extending-dev-hub`                                 |
| "Run all gates"                | `quality-gate-runner` agent                                                     |
| "Why does X work this way?"    | skill `understanding-the-architecture`                                          |
| "I keep hitting Y error"       | skill `avoiding-common-pitfalls`                                                |
| "How do I write a story test?" | skill `writing-story-tests`                                                     |
| "How does Prisma 7 work here?" | skill `working-with-prisma`                                                     |

The full lookup table is in [`.claude/AGENTS.md`](AGENTS.md).

## The six quality gates

```bash
bun run lint        # oxlint, 95 rules, ~30ms
bun run format      # oxfmt --check
bun run test:types  # tsc --noEmit on tests/types
bun run test:unit   # vitest tests/unit
bun run test:e2e    # vitest e2e + stories (append a path to filter, e.g. `bun run test:e2e tests/stories/foo.story.test.ts`)
bun run test:coverage  # ≥ 90% lines on src/core, ≥ 80% on src/modules
bun run build       # bundle to dist/
```

All six must pass before commit. If `lint`/`format` fails, run their
`*:fix` siblings. If `coverage` fails, write more story tests — don't
add files to the exclude list without strong justification.

> **Test env caveat**: tests run against an isolated Postgres
> testcontainer; `DATABASE_URL` and `NODE_ENV` from `.env` are
> intentionally ignored, so Bun's `.env` autoload can never silently
> route the suite at your dev DB. Two explicit overrides exist:
> `TEST_DATABASE_URL=<url>` (CI service container, no opt-in needed),
> or `TEST_REUSE_DEV_DB=1` (DESTRUCTIVE — tests will write to and
> drop rows from the dev DB). See `tests/CLAUDE.md` for details.

## Common gotchas (one-liners — full skill in `avoiding-common-pitfalls`)

- **Forgot `.js` suffix on import?** TypeScript will compile, runtime
  fails with `ERR_MODULE_NOT_FOUND`. Always include it.
- **Tenant-isolation 400 on a public route?** Add the path to
  `EXEMPT_EXACT` or `EXEMPT_PREFIXES` in
  `src/core/multi-tenancy/tenant-guard.ts`.
- **Feature flag doesn't show in `/dev/features`?** Missing entry in
  `src/core/dx/feature-catalog.ts`.
- **Toggling a feature doesn't take effect after restart?** Bun's
  `--watch` reloads source but **caches `process.env`**. The dev
  runner respawns the whole process when `.env` changes — that path
  is what makes toggling work.
- **`/api/docs` blank in browser?** CSP blocking the Scalar CDN. Add
  `https://cdn.jsdelivr.net` to `script-src` in
  `src/core/http/security-headers.ts` (dev only).
- **Build fails with "Could not resolve .prisma/client/default"?**
  Run `bun run prepare:schema && bun run prisma:generate` first.

## TDD cycle template

```
1. Write failing story test → bun run test:e2e <path> → confirm RED
2. Commit: test(<scope>): add red tests for <change>
3. Implement minimal code → tests green
4. Refactor without changing behavior
5. Run all 6 gates
6. Commit: feat(<scope>): <change>
```

## Don'ts (non-negotiable)

- Don't `git push --force` to main. Don't bypass hooks (`--no-verify`).
- Don't read `process.env.FEATURE_*` directly — go through `loadFeatures()`.
- Don't write features without a prior failing test (`it.skip` is forbidden).
- Don't import a feature module unconditionally — use `conditionalImport`.

## Your first move on a fresh session

If the user gives you a task, identify the matching primitive from
the lookup table above and execute it. If the user gives you no task
beyond "look around", read in this order:

1. `CLAUDE.md` (root) — orientation
2. `.claude/AGENTS.md` — what tools you have
3. `RALPH_LOG.md` — last 5 entries, what's recent
4. `OPEN_QUESTIONS.md` — what's contentious

Then ask the user what they want.

---

**Bottom line**: Match the user's intent to a primitive, follow that
primitive's spec, run the six gates, commit. The conventions encoded
in the skills mean you get the same quality as the human author with
a fraction of the cognitive load. Architecture lives in
[`docs/architecture.md`](../docs/architecture.md), conventions in
[`docs/code-guidelines.md`](../docs/code-guidelines.md), the
initialisation phase log in
[`docs/initialisation-history.md`](../docs/initialisation-history.md).
