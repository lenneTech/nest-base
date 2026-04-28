# Template-Update-Workflow

This project tracks an upstream template that owns `src/core/`. When the template
gets fixes or new features, you pull them into your project with one command.

```bash
bun run sync:from-template
```

## What it does

The runner reads the template repo's `src/core/` snapshot and your local
`src/core/`, then computes a plan with four buckets:

| Bucket | Meaning | Action |
|--------|---------|--------|
| **create** | File only in template | Written into your `src/core/` |
| **update** | File present in both, content drifted | Overwrites your local copy |
| **skip** | File present in both, content matches | No write |
| **delete** | File only in your local `src/core/` | Removed from your tree |

The planner is pure (`src/core/setup/sync-from-template.ts`); the runner just
applies the operations through `node:fs/promises`.

## Hard guarantees

- **Nothing outside `src/core/` is touched.** Your `src/modules/`,
  `tests/`, `prisma/`, `package.json`, and everything else stays exactly where
  you left it.
- **Defense-in-depth.** If the template snapshot ever contains a path outside
  `src/core/` (e.g. someone smuggled `src/modules/leak.ts` upstream), the
  planner refuses with `ProtectedPathTouchedError` and the runner aborts
  before any write.

## What to do after

A `sync:from-template` may have changed Prisma models in `prisma/features/`.
Re-run the schema concatenation and migration:

```bash
bun run prepare:schema
bunx prisma migrate deploy
```

Then your usual quality gates:

```bash
bun run lint
bun run test:e2e
bun run build
```

## Reviewing the diff

The runner prints a per-bucket summary so you can see at a glance what changed.
Use `git diff` on `src/core/` to inspect individual files before committing.

## When to run it

- After every template release (subscribe to the template repo's tags).
- Before starting any larger feature so you don't fight stale infrastructure.
- After any reported security issue against the template's `src/core/`.

## Customization stays put

If you want to keep a project-local divergence in `src/core/` (rare — usually
you'd push that change back via `sync:to-template` instead), record it in
`OPEN_QUESTIONS.md` so the next sync doesn't overwrite it accidentally. The
sync planner doesn't read this file; it's a human checkpoint.
