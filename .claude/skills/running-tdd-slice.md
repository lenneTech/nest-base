# Running a TDD Slice

The Ralph red-green-refactor procedure for one PLAN.md §32 box. Follow
it exactly when you're implementing a slice yourself; delegate to the
`slice-implementer` agent when you want to hand off the whole loop.

## Pre-flight

```bash
git status                     # clean working tree
git log --oneline -10          # recent context
grep -n "^- \[ \]" PLAN.md     # find first unchecked box
```

If `OPEN_QUESTIONS.md` has an entry blocking the next slice, address
the question first (or skip to the next independent slice).

## 1. Pick the slice

First unchecked `- [ ]` box in PLAN.md §32, in phase order
(1 → 2 → 3 → 4 → 5 → 7 → 8). Optional phases (5b/5c/6) only when
`RALPH_DIRECTIVES.md` flips them on.

State the slice in one sentence to yourself before writing any test.
If you can't, the slice isn't well-scoped — split it.

## 2. Write the red test

Path: `tests/stories/<feature>.story.test.ts` (or
`tests/<feature>.e2e-spec.ts` for HTTP-layer tests).

Skeleton:

```typescript
import { describe, expect, it } from "vitest";

import {} from // … the symbols you're about to create
"../../src/core/<area>/<feature>.js";

/**
 * Story · <Feature> (PLAN.md §<n> + §32 Phase <p>).
 *
 * <One paragraph: what the slice promises, what surfaces it touches.>
 */
describe("Story · <Feature>", () => {
  describe("<aspect>", () => {
    it("<assertion>", () => {
      // …
    });
  });
});
```

Cover:

- Happy path
- Edge cases (empty input, boundary values)
- Validation / error paths (each named error sentinel)
- Determinism (same input → same output) when applicable
- XSS safety for HTML renderers

Verify red:

```bash
bun run test:e2e tests/stories/<feature>.story.test.ts
```

The output must show the file failing — usually
`Error: Cannot find module '…/<feature>.js'`. If it accidentally
passes, the test isn't exercising new behaviour.

Commit:

```bash
git add -A
git commit -m "test(<scope>): add red tests for <slice>" -m "$(cat <<'EOF'
<short paragraph: what surfaces the test covers, e.g.
"5 stories cover happy path / two error sentinels / determinism /
empty-input handling.">
EOF
)"
```

## 3. Make it green

Write the _minimal_ code in `src/core/<area>/<feature>.ts` (or
`src/modules/`) until the red turns green. Conventions:

- Pure planner / thin runner split — see `src/core/CLAUDE.md`
- Named error sentinels (e.g. `<Feature>NotFoundError`) for
  user-distinguishable failures
- ESM imports use `.js` extensions (even on `.ts` source)
- No anticipatory features. If a future slice needs more, that slice
  writes its own test.

Verify green:

```bash
bun run test:e2e tests/stories/<feature>.story.test.ts
```

## 4. Refactor

Tighten the code. Tests stay green. Common cleanups:

- Extract repeated literals to constants
- Pull a small helper out of the main function for clarity
- Tighten type signatures (replace `unknown` with the actual type)

If a refactor breaks a test, the test is over-specified. Surface in
`OPEN_QUESTIONS.md` and pick the next slice.

## 5. Quality gates

Run all six. They must ALL pass before commit:

```bash
bun run lint
bun run test:unit
bun run test:e2e
bun run test:types
bun run test:coverage
bun run build
```

Coverage thresholds (PLAN.md mandates):

- `src/core/` ≥ **90 %** lines
- `src/modules/` ≥ **80 %** lines

If a gate fails: read the output, fix, re-run. Never bypass with
`--no-verify`, `--force`, `it.skip`, or coverage tweaks.

After three failed retries on the same gate: log in
`OPEN_QUESTIONS.md`, run `git restore .` for the slice, pick the next
independent slice. Don't loop on a stuck slice.

## 6. Mark PLAN.md done

```bash
# Edit PLAN.md: - [ ] <slice> → - [x] <slice>
```

No other PLAN.md changes. If you think the spec is wrong, that's an
`OPEN_QUESTIONS.md` entry.

## 7. Commit the green

```bash
git add -A
git commit -m "feat(<scope>): <slice>" -m "$(cat <<'EOF'
<one paragraph: what the slice does, design decision rationale>

<one paragraph: load-bearing detail you'd want to know in 6 months>

PLAN.md §32 Phase <p> box checked. <count> stories pass. Coverage
src/core <S>/<B>/<F>/<L>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## 8. Log the iteration

Append to `RALPH_LOG.md`:

```markdown
## Iteration <n> · <ISO-Timestamp>

- Phase: <p>
- Slice: <slice text>
- Tests: `tests/stories/<feature>.story.test.ts` rot (Modul fehlt) → grün (<n> Tests; <surface summary>)
- Coverage: src/core <S>/<B>/<F>/<L>, src/modules <…>
- Commits: <test-sha> (test red) · <feat-sha> (feat green) · <log>
- Blocker: none
```

Commit the log:

```bash
git commit -am "docs(ralph): log iteration <n> (<slice-summary>)"
```

## You're done

Three commits total: `test(scope): red`, `feat(scope): green`,
`docs(ralph): log`. Push when the user asks.

## Common patterns

- **Pure planner with config input** → tests assert input/output
  shape, no I/O. Examples: `buildScalarConfig`, `planSetup`,
  `planSyncFromTemplate`.
- **HTML renderer** → tests assert document chrome + form echo +
  XSS escape per surface. Examples: `renderPermissionTesterPage`,
  `renderWebhookInspectorPage`.
- **Stateful service** → tests use a per-test fake store
  (in-memory), inject a clock, never touch `process.*` or `node:fs`.
  Examples: `IdempotencyService`, `ThrottlerService`.

When in doubt, find a similar slice in `RALPH_LOG.md` and copy its
test structure.
