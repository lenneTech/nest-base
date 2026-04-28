# Core-Contribution-Guide

You found a bug in `src/core/`, or built a generic feature that doesn't belong
in `src/modules/`. This guide describes how to send the change back to the
upstream template so every project picks it up on their next
`sync:from-template`.

## TL;DR

```bash
bun run sync:to-template
# inspect the generated `core-pr.patch`
# clone the template repo, apply, push, open a PR
```

## What `sync:to-template` does

The command computes the diff between your local `src/core/` and the upstream
template snapshot and produces four buckets:

| Bucket | Meaning |
|--------|---------|
| **add** | File present locally, missing upstream — new contribution |
| **modify** | File present in both, content drifted — carries a unified-diff body |
| **skip** | File present in both, content matches — no work needed |
| **remove** | File present upstream, missing locally — *suggested* removal |

The runner writes a `core-pr.patch` you can `git apply` (or `git am`) inside a
checkout of the template repo. Output is byte-deterministic — re-running on
the same trees produces the same patch — so commit messages and review noise
stay minimal.

## The contribution flow

1. **Make the change locally.** Edit files under `src/core/`, write tests,
   run the full quality gate set:
   ```bash
   bun run lint
   bun run test:unit
   bun run test:e2e
   bun run test:types
   bun run test:coverage
   bun run build
   ```
2. **Generate the patch.**
   ```bash
   bun run sync:to-template
   ```
   The runner prints a per-bucket summary so you can confirm only the files
   you touched are included.
3. **Apply to the template.** Clone the template repo (or use an existing
   checkout), create a feature branch, and apply the patch:
   ```bash
   git checkout -b feat/<name>
   git apply path/to/core-pr.patch
   ```
4. **Open a PR upstream.** Push the branch and open a Pull Request against the
   template repo. Reference the project where the change was originally made
   so reviewers can see the production usage.

## Removal rule

The `remove` bucket is *suggested*. Most of the time a file you no longer use
locally is still relied on by other projects — don't delete it just because
your tree doesn't reference it. Treat the `remove` list as a discussion
prompt for the PR description: "If everyone agrees these are dead, the PR
that lands my add/modify entries can also drop them."

## Defense-in-depth

The planner refuses any *upstream* path outside `src/core/` with
`ProtectedPathTouchedError`. A misconfigured runner (or a maliciously-crafted
template snapshot) can't smuggle writes into your `src/modules/` tree this
way. Local paths outside `src/core/` are silently ignored on the way out.

## Maintaining a long-lived divergence

If your project genuinely needs a core change that the template can't accept,
*document it* in `OPEN_QUESTIONS.md` with a `### project-local-divergence`
heading and the rationale. The sync planners don't read this file — it's
just a checkpoint so the next person running `sync:from-template` sees the
divergence in code review and chooses whether to keep, contribute, or drop.

## When in doubt

Open the PR even if the change feels small. The cost of one PR review is
much lower than the cost of two projects diverging silently. The template
maintainer will tell you if the change should stay project-local instead.
