# `.claude/` — agent + skill index for nest-base

This file is the master index for every Claude Code primitive defined in
this repository. It exists so a fresh AI agent (or a human onboarding
into the project) can answer "where do I find the X workflow" without
spelunking through the directory tree.

> **For agent authors**: when you add a new agent / skill / command, add
> a row to the relevant table below. Keep this file flat — links into
> deeper docs, but no nested folders.

---

## Quick map

```
.claude/
├── AGENTS.md           ← you are here
├── settings.json       ← plugin enablement
├── agents/             ← spawnable sub-agents (long-running, autonomous)
├── skills/             ← procedural how-tos (read before doing X)
└── commands/           ← user-invoked slash commands (/cmd-name)
```

---

## When the user says X, reach for Y

| User intent                                                | Primitive                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| "I just opened the repo, where do I start?"                | [`QUICKSTART.md`](QUICKSTART.md)                                                     |
| "Why is X structured this way?"                            | skill: `understanding-the-architecture.md`                                           |
| "I keep hitting a weird error"                             | skill: `avoiding-common-pitfalls.md`                                                 |
| "How do I write a story test?"                             | skill: `writing-story-tests.md`                                                      |
| "How does Prisma 7 work here?"                             | skill: `working-with-prisma.md`                                                      |
| "Add a new resource / business module"                     | `/add-module` command + `module-scaffolder` agent. Reference: `src/modules/example/` |
| "Add a feature flag for Y" / "make Y toggleable"           | `/add-feature` command + `feature-toggle-implementer` agent                          |
| "Add a new dev-hub or admin page"                          | `/add-page` command + skill: `extending-dev-hub.md`                                  |
| "Run the six gates and tell me what's broken"              | `quality-gate-runner` agent                                                          |
| "Scaffold a new module under `src/modules/`"               | `module-scaffolder` agent                                                            |
| "How do I add a new error code?"                           | skill: `adding-error-code.md`                                                        |
| "How does the TDD slice flow work?"                        | skill: `running-tdd-slice.md`                                                        |
| "How do I wire a permission check on a handler?"           | skill: `wiring-permissions.md`                                                       |
| "How do I add a feature module under `src/modules/`?"      | skill: `adding-feature-module.md`                                                    |
| "Pull upstream template changes"                           | skill: `syncing-from-template.md`                                                    |
| "I just fixed a bug in `src/core/` — should I PR it back?" | skill: `contributing-upstream.md` + `/upstream-pr`                                   |
| "Open a PR back to the upstream nest-base template"        | `/upstream-pr` command                                                               |
| "User reports 403 / why does CASL deny this?"              | skill: `debugging-permission-denials.md`                                             |
| "Add or change a Prisma model"                             | skill: `writing-migrations.md`                                                       |

---

## Agents

Agents are spawned via `Agent({ subagent_type: "name", ... })` from the
parent agent. They run autonomously to completion and report back.

| Name                         | Purpose                                                                                                                                                           | Spec                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `quality-gate-runner`        | Run all six gates (`lint`, `format`, `test:types`, `test:unit`, `test:e2e`, `test:coverage`, `build`) and produce a remediation report with file:line references. | `agents/quality-gate-runner.md`        |
| `module-scaffolder`          | Create a new `src/modules/<name>/` subtree (controller + service + module + DTO + tests) following project conventions.                                           | `agents/module-scaffolder.md`          |
| `feature-toggle-implementer` | Add a toggleable feature flag end-to-end (schema → catalog → wiring → tests → live verify).                                                                       | `agents/feature-toggle-implementer.md` |

---

## Skills

Skills are procedural how-tos. The user (or another agent) reads them
before performing the action — they encode the project's conventions
and gotchas so each contributor doesn't re-discover them.

| Name                             | Purpose                                                                                                   | File                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `understanding-the-architecture` | Mental model in 200 lines — pure-planner / output-pipeline / features SoT / six gates. **Read first.**    | `skills/understanding-the-architecture.md` |
| `avoiding-common-pitfalls`       | Catalogue of every place this codebase will burn you (ESM imports, env-watch, CSP, Prisma generate, ...). | `skills/avoiding-common-pitfalls.md`       |
| `writing-story-tests`            | Concrete TDD pattern reference for `tests/stories/*.story.test.ts`.                                       | `skills/writing-story-tests.md`            |
| `working-with-prisma`            | Prisma 7 driver-adapter mode, schema concat, migrations, RLS.                                             | `skills/working-with-prisma.md`            |
| `adding-feature-flag`            | Add a toggleable feature flag — every place it must be wired.                                             | `skills/adding-feature-flag.md`            |
| `adding-feature-module`          | Scaffold a feature module under `src/modules/`.                                                           | `skills/adding-feature-module.md`          |
| `adding-error-code`              | Add a new `CORE_*` error code with i18n messages.                                                         | `skills/adding-error-code.md`              |
| `extending-dev-hub`              | Add a new dev-hub / admin page (JSON viewer wrap or custom layout).                                       | `skills/extending-dev-hub.md`              |
| `running-tdd-slice`              | The red-green-refactor cycle for a single behaviour change.                                               | `skills/running-tdd-slice.md`              |
| `syncing-from-template`          | Pull latest `src/core/` upstream into a consumer project.                                                 | `skills/syncing-from-template.md`          |
| `contributing-upstream`          | Decide _when_ a downstream change should travel back to `nest-base`, then sequence the PR safely.         | `skills/contributing-upstream.md`          |
| `debugging-permission-denials`   | Standard 5-step diagnostic path from 403 → log → permission tester → DB rules → regression test.          | `skills/debugging-permission-denials.md`   |
| `writing-migrations`             | Add/change Prisma models without breaking schema-concat, RLS, or the six gates.                           | `skills/writing-migrations.md`             |
| `wiring-permissions`             | Add CASL ability checks to a handler / route / record.                                                    | `skills/wiring-permissions.md`             |

---

## Commands

User-invoked slash commands. They live under `commands/<name>.md` and
appear as `/<name>` in the chat.

| Command                                            | Purpose                                                                                                                                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/add-module <name> [--feature-flag <key>]`        | Scaffold a project-owned resource under `src/modules/` (controller + service + DTO + module + tenant-aware tests). Bread-and-butter command for business logic. Reference module lives at `src/modules/example/`. |
| `/add-feature <key> "<description>"`               | Add a new toggleable feature flag end-to-end. Sequences the workflow under TDD discipline.                                                                                                                        |
| `/add-page <slug> "<title>" [json-viewer\|custom]` | Add a new dev-hub or admin page using the shared dark-mode shell.                                                                                                                                                 |
| `/upstream-pr [<commit-range>]`                    | Cherry-pick recent `src/core/` changes onto a fresh upstream-template branch, run upstream's six gates, push to your fork, and open a PR. Reads `.claude/upstream.json`.                                          |

---

## TDD discipline (non-negotiable)

Every change to `src/core/` and most changes to `src/modules/` follow
strict red-green-refactor:

1. **Red** — write the failing test first (`tests/stories/<feature>.story.test.ts` or `tests/<feature>.e2e-spec.ts`)
2. **Green** — minimal code to make it pass
3. **Refactor** — clean up without changing behavior
4. **Six gates** — `lint`, `format`, `test:types`, `test:unit`, `test:e2e`, `test:coverage`, `build`
5. **Commit** — Conventional Commits, one slice per commit

Coverage thresholds:

- `src/core/` ≥ 90% lines
- `src/modules/` ≥ 80% lines

UI renderers (`src/core/dx/*-ui.ts`) and glue files (modules, controllers,
interceptors, middleware, guards) are excluded from the gate — they're
exercised via story / e2e tests.

---

## Where the project state lives

| Question                 | Answer                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Architecture             | [`docs/architecture.md`](../docs/architecture.md)                                    |
| Coding conventions       | [`docs/code-guidelines.md`](../docs/code-guidelines.md)                              |
| Initialisation history   | [`docs/initialisation-history.md`](../docs/initialisation-history.md)                |
| What's been built?       | `RALPH_LOG.md` (slice-by-slice log)                                                  |
| What's known to diverge? | `OPEN_QUESTIONS.md`                                                                  |
| Per-folder rules         | `src/core/CLAUDE.md`, `tests/CLAUDE.md`, `prisma/CLAUDE.md`, `src/modules/CLAUDE.md` |

---

## Adding a new agent / skill / command

### A new skill

1. Drop a markdown file in `skills/<kebab-name>.md`.
2. First line: `# <Title Case Name>` heading.
3. Below: 1-2 sentence summary, then the procedural body.
4. End with a "Don't" section listing common mistakes.
5. Add a row to the **Skills** table above.

### A new agent

1. Drop a markdown file in `agents/<kebab-name>.md`.
2. **Required** YAML frontmatter:
   ```yaml
   ---
   name: <kebab-name>
   description: <when to spawn this agent>
   model: sonnet
   tools: Read, Edit, Write, Bash, Grep, Glob, TodoWrite
   ---
   ```
3. Body: mission statement, required reading, workflow phases, don'ts.
4. Add a row to the **Agents** table above.

### A new command

1. Drop a markdown file in `commands/<kebab-name>.md`.
2. **Required** YAML frontmatter:
   ```yaml
   ---
   description: <one-line user-facing summary>
   allowed-tools:
     - Read
     - Edit
     - Bash
   ---
   ```
3. Body: user-facing description, arguments, workflow steps,
   acceptance criteria.
4. Add a row to the **Commands** table above.

---

## For agents jumping in cold

Read in this order:

1. [`.claude/QUICKSTART.md`](QUICKSTART.md) — 60-second onboarding card
2. `CLAUDE.md` (repo root) — orientation, tech stack, conventions
3. `.claude/AGENTS.md` (this file) — what tools are available
4. `.claude/skills/understanding-the-architecture.md` — mental model
5. `.claude/skills/avoiding-common-pitfalls.md` — what _not_ to do
6. The skill / agent / command file matching your task

[`docs/architecture.md`](../docs/architecture.md) and
[`docs/code-guidelines.md`](../docs/code-guidelines.md) are the
day-to-day reference.
[`docs/initialisation-history.md`](../docs/initialisation-history.md)
is the historical record of how the server was bootstrapped — read it
when you need context on *why* something looks the way it does, not as
a spec for new work.
