# Ralph autonomous-loop config

This directory holds the Ralph autonomous-loop control surface for
nest-base.

## Files

- `config.json` — Ralph loop config. Declares the completion promise,
  the spec path, the checklist path, the verify script, and the
  quality gates / disqualifier patterns the loop enforces.
- `README.md` — this file.

## Usage

### Local (claude-code plugin)

```
/ralph-loop:ralph-loop "$(cat nest-base-loop-prompt.md)" \
  --completion-promise "ImplementedEverything" \
  --max-iterations 200
```

The plugin watches stdout for the literal completion-promise marker
and exits the loop when it appears. Each iteration the agent picks
the next unchecked row from `SPEC-CHECKLIST.md`, implements it under
strict red-green-refactor TDD, runs the six quality gates, runs
`scripts/verify-spec.sh`, greps for disqualifiers, and (on every
iteration) spawns a code-reviewer subagent to enumerate any
remaining gaps.

### CLI (ralph-import workflow)

The `ralph-import <prd-file> <project-slug>` workflow seeds a fresh
project from a PRD. For nest-base, it produces:

1. `SPEC-CHECKLIST.md` — extracted from `nest-base-prd.md` with one
   row per requirement (every Core Feature, Technical Requirement,
   Success Criterion, and explicit constraint).
2. `nest-base-loop-prompt.md` — the multi-turn instruction used by
   the plugin invocation above.

Both artifacts are version-controlled so the loop's progress is
durable across sessions.

## Promise rules

The loop only emits the completion marker when:

1. Every row in `SPEC-CHECKLIST.md` is ✅.
2. `scripts/verify-spec.sh` exits 0 (every Success Criterion has a
   passing end-to-end probe).
3. The step-6 code-reviewer subagent returns the empty list.

False promises are forbidden — the agent prefers running another
iteration over claiming completion prematurely.
