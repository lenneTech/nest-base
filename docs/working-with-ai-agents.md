# Working with AI Agents

**nest-base** is built from day one for AI-assisted development.
Every convention, every test pattern, every dev-hub page exists with
an AI agent as a first-class user — not as a "nice to have on top".

This guide tells you how to make Claude Code (or any agent that
follows the [`CLAUDE.md`](../CLAUDE.md) protocol) actually productive
on your project.

## The mental model

A new agent that opens a fresh clone of nest-base goes through this
loading sequence:

1. **`CLAUDE.md`** (root) — orientation, tech stack, conventions
2. **`.claude/QUICKSTART.md`** — 60-second onboarding card
3. **`.claude/AGENTS.md`** — what tools (agents / skills / commands) are available
4. **The skill matching the task** — `.claude/skills/<topic>.md`
5. (Lazy) **`PLAN.md`** — only when the spec is the source of truth

Read times: about 3 minutes total to be fully oriented. Compare to
the typical "explore the codebase to figure out the conventions"
session that costs 30 minutes and still leaves the agent guessing.

## When you say X, the agent reaches for Y

| You ask | Agent uses |
|---|---|
| "Add an Order resource with CRUD" | `/add-module order` (sequences red-green-six-gates-commit) |
| "Make webhooks toggleable" / "Add a feature flag" | `/add-feature` |
| "Add a /dev page that shows X" | `/add-page` |
| "Run the six gates and tell me what's broken" | `quality-gate-runner` agent |
| "Implement the next slice from PLAN.md" | `slice-implementer` agent |
| "Why is X structured this way?" | skill: `understanding-the-architecture` |
| "I keep hitting Y error" | skill: `avoiding-common-pitfalls` |
| "How do I write a story test?" | skill: `writing-story-tests` |

The full lookup table is in [`.claude/AGENTS.md`](../.claude/AGENTS.md).

## Why this works

### 1. Conventions are codified, not folkloric

Every cross-cutting decision (pure-planner / runner split, ESM `.js`
suffix, six gates, lime accent) is written down in a skill. The agent
reads the skill and does the right thing the first time — no
"explore the codebase to learn the conventions" session, no drift
between agent runs.

### 2. The dev hub is observable

Most software is opaque to an agent — it has to guess whether a
change worked. Here:

- `/dev` shows live status, coverage, tests, logs, features
- `/dev/coverage` reads the JSON the agent just wrote with `bun run test:coverage`
- `/dev/logs` is the in-memory ring buffer of every Pino record
- `/dev/features` flips toggleable features without restart wrangling

The agent can `curl /dev/status.json` and know — not guess — whether
its change broke the boot.

### 3. TDD enforces correctness

The six gates run on every commit. An agent can't "ship" a broken
slice — the gate refuses. This means the agent's failure mode is
"fails to commit" rather than "commits a regression you'll find
next Tuesday".

### 4. The example module is a lived reference

`src/modules/example/` ships with the repo as a working pattern:
Zod-DTO, tenant-aware service, Storage-interface, story tests. New
modules copy from there — the conventions become muscle memory.

## A typical session

```
You: "Add an Invoice resource. Tenant-scoped, status enum (open / paid / void),
      tied to a customer (just an id field for now). Standard CRUD."

Agent: [reads .claude/skills/adding-feature-module.md]
       [reads src/modules/example/]
       [confirms plan with you]

       1. Writes tests/stories/invoice-module.story.test.ts (red)
          → bun run test:e2e — confirms RED
          → commit: "test(invoice): add red tests for module skeleton"

       2. Copies src/modules/example/ → src/modules/invoice/
          Renames symbols, adapts fields (status enum,
          customerId), wires AppModule.

          → bun run test:e2e — passes
          → bun run lint && bun run format && bun run test:types &&
            bun run test:e2e && bun run test:coverage && bun run build
          → all six gates green

       3. Commit: "feat(invoice): scaffold src/modules/invoice/"
       4. Reports back with the route table (POST /invoices, GET, PATCH, DELETE)
          and how to verify in the dev hub
```

You sip your coffee. The slice is shipped 8 minutes after you typed
the request.

## What makes a session go sideways

The most common failure modes — most of which the skills already
prevent, but worth knowing:

- **Agent skips the regression test.** If you don't see a
  `tests/stories/<feature>.story.test.ts` change in the diff,
  something's wrong. Push back: "where's the story test?"
- **Agent reads `process.env.FEATURE_*` directly** — this bypasses
  `loadFeatures()` and the parser's section-key normalisation. Fix:
  point them at `adding-feature-flag` skill.
- **Agent disables a coverage rule** to make the gate pass — only OK
  for `*-ui.ts` (UI glue) and the explicit list in `vitest.config.ts`.
  Anything else means more tests are needed.
- **Agent commits multiple slices in one PR.** Push back: split.
  One slice = one PR is the discipline that makes review tractable.
- **Agent edits `PLAN.md` beyond a checkbox flip.** The spec is a
  user-decision artefact. Spec changes need explicit user sign-off.

If you see any of these patterns: the agent is drifting from the
discipline. Stop, re-state the convention, and have it re-do the
slice.

## Slash commands

The repo ships three user-invokable slash commands. They sequence
common workflows under TDD:

| Command | Adds |
|---|---|
| `/add-module <name> [--feature-flag <key>]` | Project resource (controller / service / DTO / module / tests) under `src/modules/` |
| `/add-feature <key> "<description>"` | Toggleable feature flag (schema + catalog + AppModule + tests) |
| `/add-page <slug> "<title>" [json-viewer\|custom]` | Dev-hub or admin page in the shared dark-mode shell |
| `/upstream-pr [<commit-range>]` | Cherry-picks recent `src/core/` changes onto an upstream-template branch and opens a PR back to `nest-base` |

Each command starts by echoing the plan back to you. Confirm before
the agent edits anything — that's the safety valve.

## Scaffolding via NestJS CLI

`@nestjs/cli` is installed (`bunx nest --help`). The repo's
`nest-cli.json` points `sourceRoot` at `src/modules/`, so
`bunx nest g resource orders` lands files in `src/modules/orders/`
following the project layout. **Test scaffolding is disabled** in
`nest-cli.json` (`spec: false`) because we write proper story tests in
`tests/stories/`, not the CLI's default jest specs.

For a fully wired module (story tests, permission gates, RLS-aware
service), prefer `/add-module` over the bare CLI — the slash command
sequences red-green-six-gates-commit.

## Contributing fixes back upstream (downstream projects)

When you fork **nest-base** to start a new project, every change you
make in `src/core/` lives in template-owned territory. The
[`contributing-upstream`](../.claude/skills/contributing-upstream.md)
skill teaches Claude to **detect** when a fix or feature is generic
enough to PR back, and the [`/upstream-pr`](../.claude/commands/upstream-pr.md)
command **executes** the PR safely.

### How Claude decides to offer a PR

After any change that touches `src/core/`, `src/shared/`, or adds a
generic capability under `src/modules/`, Claude proposes:

> The change in `src/core/concurrency/etag.ts` looks generic — no
> project-specific symbols, no domain assumptions. Want me to open
> an upstream PR against `lenneTech/nest-base`? Reply `/upstream-pr`
> to proceed, or "no, keep local" to record the divergence.

Three answers:

- **"yes" / `/upstream-pr`** — Claude clones the upstream, cherry-picks
  the commit(s), runs the upstream's six gates locally, pushes to
  your fork, and opens the PR.
- **"no, keep local"** — Claude records `### project-local-divergence`
  in `OPEN_QUESTIONS.md` and won't pester again.
- **"not sure"** — Claude asks one clarifying question (does this
  fix depend on a specific schema / vendor / auth provider?) and
  routes the answer.

### Configuring the upstream

Each project ships `.claude/upstream.json`:

```json
{
  "isTemplate": false,
  "upstream": { "repo": "lenneTech/nest-base", "branch": "main" },
  "syncedPaths": ["src/core/"]
}
```

The template repo itself sets `"isTemplate": true` so the slash
command refuses (you can't PR a repo against itself). Downstream
projects flip `isTemplate` to `false` after `bun run rename`.

### Why bother

Two reasons. First, the alternative — carrying private divergences
forever — costs you on every `sync:from-template` (merge conflicts
you'll have to re-resolve repeatedly). Second, security and
correctness fixes in core code paths benefit *every* project that
consumed the template. The five-minute cost of one PR pays itself
back the first time the template absorbs a fix you reported.

The bar for "should this PR upstream" is not high. The skill defaults
to **offer**, the user defaults to **decide**.

---

## Tips for productive sessions

- **State the success criterion up front.** "After this slice I want
  to be able to POST /orders and see it in the dev-hub admin UI." A
  concrete acceptance check shortens the loop.
- **Reference existing modules.** "Like `src/modules/example/`, but
  with these fields..." — the agent copies a known-good pattern.
- **Commit each slice yourself if you want to review.** The agent
  will commit by default; you can always `git reset --soft HEAD~1`
  if the rationale isn't right.
- **Use the dev hub.** `/dev` is the agent's sense-check tool too.
  After "I'm done" the agent can `curl /dev/status.json` and report
  back what's live. You can verify the same way visually.
- **Trust but verify.** Even with the six gates, a passing test can
  cover the wrong contract. The PR template's "verification" section
  exists to surface what the agent actually checked.

## What's missing (and how to extend it)

If a workflow you do regularly isn't covered by a skill or command:
**that's a bug in the agent setup.** Open an issue under
`feat: docs` or `feat: skills`, or — better — write the skill
yourself and PR it. The bar for skills is low: half a page of
markdown that captures the convention.

Skills compound. Every skill you add makes the next session faster.

## Reference reading order

1. [`.claude/QUICKSTART.md`](../.claude/QUICKSTART.md) — orientation
2. [`.claude/AGENTS.md`](../.claude/AGENTS.md) — full primitive index
3. [`.claude/skills/understanding-the-architecture.md`](../.claude/skills/understanding-the-architecture.md) — mental model
4. [`.claude/skills/avoiding-common-pitfalls.md`](../.claude/skills/avoiding-common-pitfalls.md) — gotchas
5. [`.claude/skills/writing-story-tests.md`](../.claude/skills/writing-story-tests.md) — TDD pattern
6. [`.claude/skills/adding-feature-flag.md`](../.claude/skills/adding-feature-flag.md) — feature toggles
7. [`.claude/skills/adding-feature-module.md`](../.claude/skills/adding-feature-module.md) — new resources
8. [`.claude/skills/extending-dev-hub.md`](../.claude/skills/extending-dev-hub.md) — new pages
9. [`.claude/skills/working-with-prisma.md`](../.claude/skills/working-with-prisma.md) — DB layer
