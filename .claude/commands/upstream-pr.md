---
description: Cherry-pick recent core changes onto a fresh upstream-template branch and open a PR.
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
  - Glob
---

# /upstream-pr

Opens a pull request against the upstream `nest-base` template with
the user's recent `src/core/` (and other synced-path) changes. Read
`.claude/skills/contributing-upstream.md` first — that file is the
source of truth for *when* to offer this. This command sequences
*how* to do it once the user has agreed.

## Arguments

```
/upstream-pr [<commit-range>]
```

- **`<commit-range>`** *(optional)* — git revision range to cherry-pick
  (e.g. `HEAD~3..HEAD`). When omitted, defaults to "every commit on
  the current branch since it diverged from the upstream sync point",
  filtered to paths under `syncedPaths`.

## Workflow

### 0 · Read `.claude/upstream.json` and refuse if needed

```bash
cat .claude/upstream.json
```

Refuse with an explanatory message if any of these:

- File is missing → tell the user: *"No `.claude/upstream.json`. This
  command needs an upstream config. Want me to write one pointing at
  `lenneTech/nest-base`?"* Wait for confirmation.
- `isTemplate: true` → *"This repo IS the upstream template. Opening
  a PR against itself isn't meaningful — close out the change here
  directly."*
- `upstream` is null or missing `repo` → ask which repo to target.

### 1 · Confirm with the user before any network call

State the plan back:

> I'll cherry-pick `<N>` commit(s) from `<branch>` onto a fresh
> branch of `<upstream.repo>@<upstream.branch>`, run the upstream's
> six quality gates, push to your fork (`<gh-user>/<upstream-repo>`),
> and open a PR. Continue?

Only proceed on a clear "yes". If the user is unsure, walk them
through which commits will travel:

```bash
git log --oneline <range> -- $(jq -r '.syncedPaths[]' .claude/upstream.json)
```

### 2 · Sanity-check the diff doesn't smuggle project-specific code

For every file in the cherry-pick, grep for imports outside
`syncedPaths`:

```bash
git diff <range> -- $(jq -r '.syncedPaths[]' .claude/upstream.json) \
  | grep -E "^\+.*from ['\"]\.\./" \
  | grep -v -F "$(jq -r '.syncedPaths[]' .claude/upstream.json)"
```

If any line resolves to a path **outside** `syncedPaths`, stop and
report. Either the user refactors first, or the change stays
project-local.

### 3 · Prepare the upstream clone

```bash
TMPDIR=$(mktemp -d)
UPSTREAM=$(jq -r '.upstream.repo' .claude/upstream.json)
BRANCH=$(jq -r '.upstream.branch' .claude/upstream.json)
gh repo clone "$UPSTREAM" "$TMPDIR/upstream"
cd "$TMPDIR/upstream"
git fetch origin "$BRANCH"
git checkout -B feat/<scope>-<short> origin/$BRANCH
```

### 4 · Cherry-pick

For each commit in `<range>`:

```bash
cd <project-root>
git format-patch --stdout <commit>^..<commit> -- $(jq -r '.syncedPaths[]' .claude/upstream.json) \
  > "$TMPDIR/$(git rev-parse --short <commit>).patch"
```

Then in the upstream clone:

```bash
cd "$TMPDIR/upstream"
git am "$TMPDIR"/*.patch
```

If `git am` fails with conflicts: stop and report. Manual rebase
(human) is required when the upstream has drifted.

### 5 · Run the upstream's six gates

```bash
cd "$TMPDIR/upstream"
bun install --frozen-lockfile
bun run lint && \
bun run format && \
bun run test:types && \
bun run test:unit && \
bun run test:e2e && \
bun run test:coverage && \
bun run build
```

If any gate fails, stop and report — the user needs to know whether
the failure is something the upstream codebase can absorb or whether
the fix needs more work.

### 6 · Push to the user's fork

The user must already have a fork. If `gh repo view <gh-user>/<repo>`
fails, run:

```bash
gh repo fork "$UPSTREAM" --clone=false
```

Then push:

```bash
cd "$TMPDIR/upstream"
git remote add fork "https://github.com/$(gh api user --jq .login)/$(echo $UPSTREAM | cut -d/ -f2).git"
git push fork HEAD
```

### 7 · Open the PR

Build the body from the cherry-picked commit messages plus a
reference back to the consumer project:

```bash
gh pr create \
  --repo "$UPSTREAM" \
  --base "$BRANCH" \
  --head "$(gh api user --jq .login):feat/<scope>-<short>" \
  --title "<scope>: <one-line summary>" \
  --body "$(cat <<'EOF'
## Summary
<bullet points from each cherry-picked commit>

## Origin
This change was developed in a downstream consumer project of nest-base.
Run there: <consumer-project-name>@<short-sha>.

## Test plan
- [x] lint
- [x] format
- [x] test:types
- [x] test:unit
- [x] test:e2e
- [x] test:coverage
- [x] build

🤖 Generated with [Claude Code](https://claude.com/claude-code) via /upstream-pr
EOF
)"
```

Print the PR URL to the user.

### 8 · Cleanup

```bash
rm -rf "$TMPDIR"
```

Don't delete the local fork remote on success — the user may want to
push follow-ups.

## Don't

- **Don't push to upstream's main branch directly.** Always push to
  the user's fork, always via PR.
- **Don't bypass the upstream's quality gates** with `--no-verify`
  or by skipping the `bun install` step. Upstream may have drifted.
- **Don't squash the commits** without asking — they may carry
  meaningful structure (red test, green impl, refactor).
- **Don't include unrelated commits** in the cherry-pick — the user
  may have local commits that touch synced paths but are
  project-specific.
- **Don't auto-merge.** The PR sits in upstream's review queue. The
  user is done after the PR opens.

## When stuck

- `git am` conflicts → stop, report, suggest manual rebase. Don't
  force resolution.
- Upstream gates fail on a clean checkout (i.e. before our patches)
  → upstream is currently broken; reschedule, don't fight it.
- `gh` not authenticated → tell the user to run `gh auth login`.
  Never store credentials.
- `.claude/upstream.json` parsing error → tell the user the schema
  and offer to rewrite.

## Acceptance criteria

The slash command finishes successfully when **all** of these hold:

1. The upstream-fork branch contains the cherry-picked commits.
2. The upstream's six quality gates passed locally.
3. The PR is open on `<upstream.repo>` with the correct base branch.
4. The PR URL is printed to the user.
5. No leftover state in the consumer repo (no temp branches, no
   modified working tree).
