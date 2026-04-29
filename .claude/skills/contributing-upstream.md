# Contributing Upstream — When and How

A downstream project that consumed `nest-base` ships its own domain
code in `src/modules/` while keeping `src/core/` byte-equal to the
template. When you fix a bug or build a generic capability **inside
`src/core/`**, the change usually deserves to flow back to the
template — every other consumer benefits, and you avoid carrying a
private divergence forever.

This skill teaches Claude when to recognise that opportunity and how
to convert it into a pull request without leaving the consumer repo.

## Trigger conditions — when to offer an upstream PR

After any change in the consumer repo, ask the upstream-PR question
when **any** of these hold:

1. **The diff touches `src/core/`** (synced template surface). Even
   one line. The whole point of the boundary is that core changes are
   shared.
2. **The diff touches `src/shared/`** (cross-tier types). Generic by
   construction.
3. **The diff adds a *generic* capability in `src/modules/`** that
   has no project-specific assumptions. Examples that should usually
   PR upstream:
   - A new `BaseRepository` extension with no project-specific schema
   - A new HTTP middleware / interceptor that works for any API
   - A new test helper in `tests/lib/`
   Examples that should usually stay project-local:
   - A `BillingService` that calls Stripe with the project's account ID
   - A `report-renderer.ts` shaped around the project's invoice format
4. **The diff fixes a security issue** in template-shipped code.
   Always offer (and prioritise) — every consumer is exposed.
5. **The diff fixes a bug whose reproduction lives in core code paths**
   (e.g. an off-by-one in `cursor-pagination.ts`).

When **none** of those hold, do not pester the user. Project-specific
changes should not get an upstream prompt.

## Decision flow

When the trigger fires, present the user with a one-paragraph
proposal:

> The change in `src/core/concurrency/etag.ts:42-58` looks generic —
> it fixes a hash collision when the body contains binary data. Want
> me to also open an upstream PR against `lenneTech/nest-base` so
> every consumer picks this up on their next sync? (`/upstream-pr` to
> proceed)

The user has three responses:

- **"yes"** — proceed with `/upstream-pr` (see the slash command).
- **"no, project-specific"** — record the divergence in
  `OPEN_QUESTIONS.md` under `### project-local-divergence` so the
  next `sync:from-template` reviewer sees the override is intentional.
  Don't pester again about this change.
- **"not sure"** — ask one clarifying question: *"Does this fix
  depend on anything specific to your domain (a particular DB schema,
  a particular auth provider, a particular vendor SDK)?"*. The answer
  routes back to "yes" or "no".

## Boundary rules

- **Never auto-open the PR.** The user must confirm — opening a PR
  is a public action with their identity attached, and the call is
  always theirs to make.
- **Never push without confirmation.** Even after the user says yes,
  show the cherry-picked commit and the PR body draft before pushing.
- **Refuse if `.claude/upstream.json` declares `isTemplate: true`**.
  That file is the marker that this repo *is* the upstream — you
  cannot PR a repo against itself.
- **Don't smuggle project-specific code into the PR.** Pre-flight the
  cherry-pick: if the patch references symbols from `src/modules/`,
  refactor first or back out.

## Reading the upstream config

Every project that consumed the template ships
`.claude/upstream.json`:

```json
{
  "isTemplate": false,
  "upstream": { "repo": "lenneTech/nest-base", "branch": "main" },
  "syncedPaths": ["src/core/"]
}
```

When `isTemplate: true`, the project IS the template — refuse the
upstream-PR flow and explain. When the file is missing, ask the
user for the upstream repo (and offer to write the config so the
next time is friction-free).

## Workflow when the user says "yes"

The slash command `/upstream-pr` automates the safe sequence:

1. Validate `.claude/upstream.json` (config exists, isTemplate=false,
   upstream.repo set).
2. Detect the change set: `git log` since the last upstream sync,
   filtered to paths under `syncedPaths`. Show the user the list of
   commits that will travel.
3. Prepare a fork: clone `<upstream.repo>` to a temp dir, checkout
   the configured branch, create a feature branch named
   `<scope>/<short-summary>` based on the source branch.
4. Cherry-pick the relevant commits (or apply a single combined
   patch produced via `bun run sync:to-template`). Preserve commit
   messages.
5. Run the upstream's quality gates locally on the temp clone — same
   six commands. Show the user any failures and stop.
6. Push to `<user>/<repo-fork>` (the user must already have a fork;
   if not, walk them through `gh repo fork` once).
7. Open the PR with `gh pr create`, body templated from the consumer
   commit messages + reference to this project.
8. Print the PR URL back to the user.
9. Clean up the temp clone.

## When NOT to suggest

- **Never** suggest while the user is mid-flow on a different task —
  wait until the slice is committed cleanly.
- **Never** suggest on commits whose only file under `syncedPaths` is
  `package.json` or `package-lock.json` (dependency bumps belong to
  whoever maintains the upstream).
- **Never** suggest more than once for the same change. Track in
  `OPEN_QUESTIONS.md` what was already asked.

## What the user sees

A typical interaction in a downstream project:

```
You: fix the etag collision when body is binary

Agent: [investigates src/core/concurrency/etag.ts, writes test, fixes]
       Six gates green. Committed as fix(concurrency): etag collision
       on binary bodies.

       This change touched src/core/. It looks generic — no project-
       specific symbols, no domain assumptions. Want me to open an
       upstream PR against lenneTech/nest-base so every consumer
       picks it up on their next sync? Reply /upstream-pr to proceed,
       or "no, keep local" to record the divergence.

You: /upstream-pr

Agent: [reads .claude/upstream.json → isTemplate=false → upstream is
        lenneTech/nest-base@main]
       Will cherry-pick 1 commit (a3f9c12) onto a fresh branch in
       a clone of lenneTech/nest-base. Continue? [y/N]

You: y

Agent: [clones, cherry-picks, runs six gates upstream → all green]
       Six gates green on the upstream branch. Push to your fork
       pascalklesse/nest-base and open PR? [y/N]

You: y

Agent: [pushes fix/etag-collision-binary, gh pr create]
       PR opened: https://github.com/lenneTech/nest-base/pull/123
```

That's the goal. Quiet detection, explicit confirmation, no surprises.

## Don't

- Don't open a PR upstream that depends on uncommitted local changes —
  cherry-pick from committed history only.
- Don't squash commits without asking — they may have value as a
  story.
- Don't reword commit messages — the upstream maintainer chooses
  whether to squash on merge.
- Don't bypass the upstream's quality gates because "they passed
  locally" — the upstream tree may have drifted.
- Don't open an upstream PR for changes that depend on `bun run
  setup` or other project-bootstrap state. Generic ≠ guarded by
  consumer config.
