Build the nest-base per nest-base-prd.md.

PROCESS (do every iteration):

1. If SPEC-CHECKLIST.md doesn't exist, create it. Extract EVERY requirement
   from nest-base-prd.md — every Core Feature, every Technical Requirement,
   every Success Criterion, every constraint — as an unchecked row with
   columns: spec quote, section reference, status (todo|done|blocked),
   file:line where implemented, test/check name proving it works, evidence
   (command output line / log line).

2. Pick the next unchecked row. Implement it. Add a passing test or
   verification check. Update the row with file:line + evidence.

3. Run the project's full verification suite (typecheck + lint + unit tests +
   integration tests). If the toolchain doesn't exist yet, set it up FIRST as
   a dedicated checklist item — derive the choice from the Technical
   Requirements section of nest-base-prd.md. All checks must pass before
   continuing.

4. Run scripts/verify-spec.sh — create it if missing. It must exercise every
   Success Criterion from nest-base-prd.md end-to-end (boot / apply / curl /
   assert / whatever the project needs) and exit non-zero on any miss.

5. Grep the codebase for these disqualifiers — any hit blocks the promise:
  - 'TODO'
  - 'FIXME'
  - 'XXX'
  - 'stub'
  - 'placeholder'
  - 'NotImplemented'
  - 'as any'
  - 'as never'
  - 'as unknown as'
  - '@ts-ignore'
  - '@ts-expect-error'
  - 'return { ok: true }'
  - 'console.log(' in src
  - 'void body;'
  - 'void id;'
  - 'exit 0  # TODO'
  - 'true  # placeholder'
  - 'echo "not implemented"'

6. Spawn a code-reviewer subagent with prompt: "Read nest-base-prd.md and the
   codebase. List every spec requirement that is missing, partial, or
   stubbed. Cite file:line. Be ruthless." If it returns ANY items, you are
   NOT done.

PROMISE RULES:

- Promise only when SPEC-CHECKLIST.md has zero unchecked rows AND
  scripts/verify-spec.sh exits 0 AND the step-6 reviewer returns an empty
  list.
- Forbidden words in any completion summary: 'wired', 'stubbed',
  'scaffolded', 'placeholder', 'TBD', 'out of scope', 'deferred', 'in scope
  for', 'should work', 'presumably'. Using any of these means you are NOT
  done.
- Each iteration where you don't promise, end with: a) checklist progress
  (X/Y), b) the next 3 unchecked items.
- Lying about progress costs more than running another iteration. Running
  100 iterations is fine. False promise is not.

CRITICAL — PROMISE TAG PROTECTION:

The plugin watches stdout for the literal string
`<promise>ImplementedEverything</promise>` and exits the moment it appears
anywhere in your output. If you mention it in passing — in a sentence,
comment, code, explanation, planning text, or hypothetical example — the
loop exits prematurely and the project ships broken.

Therefore: do NOT write that literal string in any context EXCEPT the
single final completion line, AFTER all six PROCESS checks above have
passed. If you need to refer to it during a loop iteration, say "the
completion marker" or "the final tag" — never write the literal characters.

Output `<promise>ImplementedEverything</promise>` ONLY as the final line of your
output when all six checks are satisfied.
