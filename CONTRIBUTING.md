# Contributing to nest-base

Thanks for considering a contribution. This file is the minimum you
need to know before opening a PR.

For deeper context:

- [`docs/architecture.md`](./docs/architecture.md) — how the system is
  put together (modules, permission model, output pipeline, security
  layers).
- [`docs/code-guidelines.md`](./docs/code-guidelines.md) — conventions a
  quick scan won't teach you (naming, validation, error codes, planner /
  runner split, HTML escaping, …).
- [`CLAUDE.md`](./CLAUDE.md) — the agent-facing "where do I find X"
  index.

## TL;DR

1. **One slice per PR**, Conventional Commit title, six gates green.
2. **Story test or e2e spec for every behaviour change** — red first,
   green after.
3. **`src/core/` is template-owned** (synced to every consumer). New
   project-specific code goes in `src/modules/`. Generic utilities
   that benefit every consumer can be PR'd to `src/core/` — but the
   review bar is higher there.

## Before you start

- Read [`.claude/QUICKSTART.md`](./.claude/QUICKSTART.md) — the 60-second
  onboarding card. It tells you where everything lives and what
  conventions are non-negotiable.
- For architectural context, read
  [`docs/architecture.md`](./docs/architecture.md). For conventions,
  [`docs/code-guidelines.md`](./docs/code-guidelines.md). The
  eight-phase initialisation log lives in
  [`docs/initialisation-history.md`](./docs/initialisation-history.md)
  for historical reference.
- For a feature flag: read
  [`.claude/skills/adding-feature-flag.md`](./.claude/skills/adding-feature-flag.md).
- For a new Hub/admin page: read
  [`.claude/skills/extending-hub.md`](./.claude/skills/extending-hub.md).
- For a new resource module: read
  [`.claude/skills/adding-feature-module.md`](./.claude/skills/adding-feature-module.md)
  and copy [`src/modules/example/`](./src/modules/example/) as the
  reference.

## Setup

```bash
git clone git@github.com:lenneTech/nest-base.git
cd nest-base
bun install
bun run setup            # generates .env with strong random secrets
docker compose up -d postgres
bun run prisma:generate
bun run dev              # opens the Hub at /hub
```

## The TDD cycle

Every behaviour change follows red → green → refactor:

1. **Write the failing test first** in `tests/stories/<feature>.story.test.ts`
   (pure planners) or `tests/<feature>.e2e-spec.ts` (HTTP layer).
2. Confirm it's red:
   ```bash
   bun run test:e2e tests/stories/<your-test>.story.test.ts
   ```
3. Commit: `test(<scope>): add red tests for <slice>`
4. Implement the minimum code to make the test pass.
5. Refactor without changing behaviour. Tests stay green.
6. Run all six gates:
   ```bash
   bun run lint && \
   bun run format && \
   bun run test:types && \
   bun run test:unit && \
   bun run test:e2e && \
   bun run test:coverage && \
   bun run build
   ```
7. Commit: `feat(<scope>): <slice>` (or `fix(<scope>):`, etc.)

Coverage thresholds: `src/core/` ≥ 80% lines, `src/modules/` ≥ 75% lines (enforced
by `vitest.config.ts` via `src/core/testing/coverage-gate.ts`).
Failing the gate forces more tests, **not** more exclusions.

## Conventional Commits

| Type | When |
|---|---|
| `feat(<scope>):` | New behaviour, new feature flag, new page |
| `fix(<scope>):` | Bug fix |
| `test(<scope>):` | Adding a test (red commit before the impl) |
| `docs(<scope>):` | Docs only |
| `refactor(<scope>):` | No behaviour change |
| `chore(<scope>):` | Dependency bumps, tooling, repo hygiene |
| `ci(<scope>):` | CI / build pipeline |
| `perf(<scope>):` | Measurable performance improvement |

Scope examples: `auth`, `webhooks`, `dev-hub`, `features`,
`<resource-name>` for module changes.

## What happens after you open a PR

1. **CI runs the same six gates** (lint, format, types, unit, e2e,
   coverage, build) on the PR branch — same matrix that runs on
   `main`. The aggregator job `ci-success` flips green only when
   every required gate passed.
2. A maintainer (`@lenneTech` per [`CODEOWNERS`](./.github/CODEOWNERS))
   gets requested as a reviewer.
3. We review for: fits-the-spec, test-first, conventions, and
   "would a future agent reading this commit understand it".

### For repository owners — recommended branch protection

Set this once on `main` so PRs can't bypass the gates:

- **Require a pull request before merging** ✓
- **Require approvals**: 1
- **Dismiss stale approvals on new commits** ✓
- **Require review from Code Owners** ✓
- **Require status checks to pass before merging** ✓
  - Required check: `ci-success` — the aggregator job in
    `.github/workflows/ci.yml`. Flips green only when lint / format /
    test-types / test-unit / test-e2e / test-coverage / build all
    passed. One switch covers the whole gate matrix.
  - **Require branches to be up to date before merging** ✓
- **Require conversation resolution before merging** ✓
- **Do not allow bypassing the above settings** ✓ (even for admins)

## AI-driven contributions

This project is **optimised for AI-assisted development** with Claude
Code. If you're using an AI agent:

- Spawn `feature-toggle-implementer` for feature flags
- Spawn `module-scaffolder` for new resources
- Use `/add-feature`, `/add-module`, `/add-page` slash commands
- Read the matching skill in `.claude/skills/` before letting the
  agent loose

The agent will follow the same TDD discipline + six gates. If it
doesn't, that's a bug in the skill — open an issue.

## What does NOT belong here

- **Project-specific business logic** — keep that in your fork's
  `src/modules/`. The template is a template.
- **Optional dependencies that drag CI weight** — every package added
  affects every consumer's `bun install` time.
- **Copy-pasted code from other repos** — re-implement in the project's
  conventions or PR upstream-of-here.

## Code of conduct

By participating, you agree to follow our
[Code of Conduct](./CODE_OF_CONDUCT.md). Be kind. We're all here to
ship better code.

## Security

Found a vulnerability? **Don't file a public issue.** See
[`SECURITY.md`](./SECURITY.md) for the private disclosure path.

## Questions

For free-form questions, use [GitHub Discussions](https://github.com/lenneTech/nest-base/discussions).
For specific bug reports or feature requests, use the issue templates.
