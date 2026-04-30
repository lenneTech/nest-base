---
description: Add a new toggleable feature flag end-to-end (schema → catalog → wiring → tests → dev-hub).
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
  - Glob
---

# /add-feature

Adds a new toggleable feature flag to nest-base end-to-end. Read the
companion skill `.claude/skills/adding-feature-flag.md` first — that
file is the source of truth for _what_ needs to change. This command
sequences _how_ you change it under the strict TDD discipline.

## Arguments

User invokes:

```
/add-feature <key> "<description>"
```

- **`<key>`** — camelCase identifier, e.g. `notifications`. Becomes
  the FeaturesSchema field, the FEATURE_NOTIFICATIONS_ENABLED env-var,
  and the catalog `key`.
- **`<description>`** — one-sentence summary used in the catalog card.

If arguments are missing, ask the user explicitly. Do **not** guess.

## Workflow

### 0 · Confirm before any edit

State your plan back to the user:

> I'll add a `<key>` feature flag (default OFF, category `<category>`)
> exposing `<list>`. ENV-var `FEATURE_<KEY>_ENABLED`. This touches
> features.ts, feature-catalog.ts, app.module.ts, diagnostics.ts, and
> the relevant story tests. Shall I proceed?

Only proceed after the user confirms. If category / default / exposes
isn't clear, ask.

### 1 · Red — write the failing test first

Edit `tests/stories/features.story.test.ts` (or the closest existing
story for your category) to assert:

- the default state matches your decision
- `loadFeatures({ FEATURE_<KEY>_ENABLED: "true" })` flips the field
- `isFeatureActive` and `summarizeFeatures` count the new entry

Run `bun run test:e2e tests/stories/features.story.test.ts` and
confirm RED. Commit:

```
test(features): add red tests for <key> feature flag
```

### 2 · Green — wire the schema + parser

Per the skill, in this order:

1. `src/core/features/features.ts` — new section schema, FeaturesSchema field, ToggleableFeatureKey union, SECTION_KEYS entry, SECTION_TO_KEY mapping.
2. `src/core/dx/feature-catalog.ts` — new FEATURE_CATALOG entry with description, exposes, envKey, category.
3. `src/core/app/app.module.ts` — `conditionalImport(features, '<key>', YourModule)` if the feature comes with a module. (Skip if the feature is purely a switch consumed by other code.)
4. `src/core/dx/diagnostics.ts` — extend `DiagnosticsFeaturesReport` and `summariseFeatures`.
5. `src/core/dx/service-status.ts` — only if the feature has an external service container; gate on **both** `features.<key>.enabled` AND the URL env-var.

Run `bun run test:e2e tests/stories/features.story.test.ts tests/stories/feature-catalog.story.test.ts` and confirm GREEN.

### 3 · Six gates

```bash
bun run lint && \
bun run format && \
bun run test:types && \
bun run test:unit && \
bun run test:e2e && \
bun run test:coverage && \
bun run build
```

All six must pass. Coverage thresholds:

- `src/core/` ≥ 90% lines
- `src/modules/` ≥ 80% lines

### 4 · Live verify in the dev hub

If the dev server isn't already running, mention it to the user — the
verification is part of the acceptance:

```bash
bun run dev   # opens http://localhost:3000/dev
```

User clicks **Features** in the sidebar. Confirm:

- New card appears under the chosen category with description, exposes
  badges, and `FEATURE_<KEY>_ENABLED=false ✓` line
- Toggling the switch shows the "Restarting server…" overlay
- After respawn the card flips to ON
- `/dev/diagnostics` shows the flag in the active-features matrix

### 5 · Commit + push

```
feat(<scope>): add <key> feature flag (default OFF/ON)
```

In the body summarise: schema location, catalog category, exposed
surfaces, default state, what `conditionalImport` toggles. Push.

## Don't

- Don't skip the regression test in `feature-catalog.story.test.ts` —
  it catches envKey/section-key drift before merge.
- Don't import a module unconditionally — `conditionalImport` keeps
  OFF=zero-cost.
- Don't gate service-status on the URL alone — use AND with the flag.
- Don't bypass the six gates with `--no-verify` or `it.skip`.

## When stuck

- Read `src/core/features/features.ts` for the parser shape, especially `splitSectionField` to understand how multi-word section names resolve.
- Look at how an existing similar feature did it: `webhooks` for HTTP-out integrations, `realtime` for socket-based, `fieldEncryption` for cross-cutting transformers.
- The skill `.claude/skills/adding-feature-flag.md` covers every edge case (multi-word section names, FIELD_ENCRYPTION-style aliases, custom sub-schemas).
