---
description: Run the LLM-driven feature-test loop and report the findings — runs `bun run llm-test`, waits for the headless agent to finish, then triages the friction log into actionable recommendations. Pushes a desktop / mobile notification when the run is done.
allowed-tools:
  - Bash
  - Read
  - PushNotification
---

# /llm-test

Runs `bun run llm-test` (the autonomous Claude session that scaffolds a
`--next` workspace, builds a multi-tenant Todo app, and writes a
friction log). When the run finishes, parse the friction log, classify
each entry, and report back with concrete recommendations.

## Arguments

User invokes:

```
/llm-test            # default 90-min run
/llm-test 30         # custom timeout in minutes
/llm-test full       # alias for 90 min
/llm-test pilot      # alias for 15 min — fastest cheap signal
```

Parse `$ARGUMENTS`:

- empty / `full` → `--timeout 90`
- `pilot` → `--timeout 15`
- a bare number → `--timeout <N>`
- anything else → assume number; if not a valid integer, default to 90 and warn

## Workflow

### 1. Pre-flight

State to the user that you're about to start a long-running test that
costs subscription tokens and takes the requested wallclock minutes.
Confirm `claude` is on `PATH`:

```bash
which claude
```

If missing, abort and tell the user to install / log in.

### 2. Start the run in the background

```bash
bun run llm-test --timeout <minutes>
```

Use `run_in_background: true` so the conversation isn't blocked. The
script prints its archive paths at the end — those are the only files
you need to read after.

State to the user that the run is going, give the timeout, and tell
them you'll report back when it's done. They can interrupt with
`/cancel-llm-test` (not implemented — they can `pkill -f
llm-feature-test`).

### 3. Wait for completion

The Bash background-task framework will deliver an automatic
notification when the script exits. You do **not** need to poll.

Optionally — only if the user explicitly asks for periodic updates —
you can read `~/.cache/lt-llm-test/run-<latest>/friction.md` every few
minutes for a status snapshot.

### 4. Locate the archived friction log

When the run finishes, the script wrote `friction.md` and
`transcript.jsonl` to `~/.cache/lt-llm-test/archive/<timestamp>/`. The
script also printed those paths in its final lines — check the script
exit summary first; if missing, find the latest archive dir:

```bash
ls -t ~/.cache/lt-llm-test/archive/ | head -1
```

### 5. Read + classify

Read `friction.md`. For each `### YYYY-MM-DDThh:mm · area · title`
entry, classify it on three axes:

**Regression vs new finding** — compare against
`tests/llm-feature-test/plan-doc.md` "What's already fixed" list. If
the entry maps to a fixed item, it is a **regression** and is critical
regardless of severity.

**Class:**

- `regression` — was supposed to be fixed; isn't.
- `template-bug` — bug in `nest-base` source / migrations / scripts.
- `cli-bug` — bug in `lt fullstack init --next` scaffolding.
- `doc-gap` — README / CLAUDE.md / QUICKSTART says X, code does Y.
- `dx-drift` — confusing convention, slowed the agent down without
  fully blocking.
- `nice-to-have` — observed-but-not-painful nit.

**Recommendation:**

- `fix-now` — regression OR severity ≥ high. Block on this.
- `fix-soon` — medium severity, clear root cause, no workaround
  documented.
- `discuss` — unclear if bug or design choice; needs human call.
- `skip` — nit / low severity / out of scope.

### 6. Push notification

The run was long enough that the user almost certainly walked away. Use
`PushNotification` exactly once — when the run is done and you've
classified the findings — with a one-line headline they would act on.

Severity-ordered message templates (pick the worst case that applies):

- timeout / crash:
  `LLM-test failed — <reason> after <wallclock>m`
- regressions present:
  `LLM-test: <N> regressions, <M> new — review now`
- blocker / high present:
  `LLM-test: <N> blocker, <M> high, <K> med — review when free`
- only medium / low:
  `LLM-test: <N> findings, none critical — read when free`
- clean:
  `LLM-test clean — 0 frictions in <wallclock>m`

Keep under 200 chars. No markdown. Lead with the headline. Send only
once per run. Do **not** send notifications during the run, on each
finding, or for routine progress.

### 7. Report back

Format your in-chat reply as:

```
LLM-Test report — <wallclock> · <archive-path>

Findings: <N> total
  - blocker: <count>
  - high:    <count>
  - medium:  <count>
  - low:     <count>
  - nit:     <count>

Regressions: <count>  (any > 0 ⇒ should not have happened)

Per finding:
  [<severity>] <class> · <title>
    → <recommendation>: <one-line action>

Recommended next step:
  <a single sentence: "fix #N then re-run", "ship as-is",
   "discuss design of X first", etc.>
```

Then ask the user which findings they want to fix now vs defer.

### 8. Apply fixes (optional, only on user signal)

If the user picks specific findings to fix, treat each as its own
mini-task: locate the relevant file in `src/core/` or wherever, make
the fix, run quality gates, commit, push. Don't auto-fix everything —
the user opts in per finding.

## Don'ts

- Don't read `~/.cache/lt-llm-test/run-*/transcript.jsonl` unless the
  user asks for forensic detail. It's huge and burns context.
- Don't intervene mid-run. The agent is autonomous; the wallclock
  timeout is the safety bound.
- Don't claim a finding is fixed before re-running the test (or at
  least running the relevant six gates).
- Don't blindly trust the agent's "Suggested fix:" line — it's a
  starting point, not a spec. Verify before applying.

## Useful related commands

- `bun run llm-test --keep-workspace` — preserve the full generated
  project for forensic inspection
- `pkill -f llm-feature-test` — cancel a running session

## When to invoke this command

User says any of:
- "mach llm-test"
- "/llm-test"
- "lass den llm-test laufen"
- "neuer testlauf"

Treat all as the same trigger. If they include a duration ("kurz",
"voll", "30 minuten"), parse it.
