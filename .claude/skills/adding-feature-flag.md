# Adding a Feature Flag

`features.ts` is the single source of truth for runtime module-
activation. Every conditional module reads `FeaturesSchema.parse(...)`
— never hard-code `if (process.env.FOO_ENABLED === 'true')`.

This skill walks through every place a new toggleable feature must be
wired. The end state: the feature appears on **/hub/features** with
description + on/off toggle, the user can flip it from the UI, the
server respawns, the new providers light up.

---

## Pre-flight checklist

Before you touch code, decide:

| Question                            | Why                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------- |
| Default ON or OFF?                  | Cross-cutting infra → ON. Opt-in workflow → OFF.                        |
| Single ENV section name?            | Must be ALL-CAPS, no hyphens. Becomes `FEATURE_<NAME>_ENABLED`.         |
| External services involved?         | If yes, add to `service-status.ts` after the catalog entry.             |
| Custom sub-fields beyond `enabled`? | Define a Zod sub-schema; otherwise `togglableDefault(false)` suffices.  |
| New /admin or /dev page?            | Plan the URL up-front so the catalog entry can list it under `exposes`. |

---

## The walkthrough — adding `notifications`

### 1. Schema entry — `src/core/features/features.ts`

```typescript
const Notifications = togglableDefault(false); // default off

export const FeaturesSchema = z.object({
  // ... existing fields
  notifications: Notifications.default(() => Notifications.parse({})),
});
```

If you need more than `enabled`:

```typescript
const NotificationsSchema = z.object({
  enabled: z.boolean().default(false),
  channels: z.array(z.enum(["email", "webhook", "realtime"])).default([]),
});
```

Update the union:

```typescript
export type ToggleableFeatureKey =
  | "multiTenancy"
  | // ... existing
  | "notifications";
```

### 2. ENV-parser mapping — same file

The parser lower-cases `FEATURE_*_ENABLED` and splits on underscore. To
map `FEATURE_NOTIFICATIONS_ENABLED` → `notifications`:

```typescript
const SECTION_KEYS = new Set([
  // ... existing
  "NOTIFICATIONS", // ← add
]);

const SECTION_TO_KEY: Record<string, FeatureKey> = {
  // ... existing
  NOTIFICATIONS: "notifications",
};
```

> **PowerSync gotcha** — `POWERSYNC` (no underscore) maps to `powerSync`.
> If your section name has multiple words, both `WORD_WORD` and `WORDWORD`
> may be needed. See `FIELDENCRYPTION` + `FIELD_ENCRYPTION` aliases.

### 3. Feature catalog — `src/core/dx/feature-catalog.ts`

This drives the `/hub/features` UI. **Without a catalog entry, the
toggle does not appear in the dashboard.**

```typescript
export const FEATURE_CATALOG: readonly FeatureMeta[] = [
  // ... existing
  {
    key: "notifications",
    label: "Notifications",
    description: "Multi-channel transactional notifications (email + webhook).",
    envKey: "FEATURE_NOTIFICATIONS_ENABLED",
    category: "communication", // infrastructure | data | communication | integration | observability
    exposes: ["NotificationService", "/admin/notifications", "@OnNotification()"],
  },
];
```

### 4. Regression guard — `tests/stories/feature-catalog.story.test.ts`

The existing test loops over every catalog entry and verifies that
`loadFeatures({ [meta.envKey]: "true" })` actually flips the feature
on. If your `envKey` doesn't match the parser's expected shape, this
test catches it before merge.

```typescript
// already in place, just confirm it runs
it("jeder envKey wird vom features.ts Parser tatsächlich erkannt", () => {
  for (const meta of FEATURE_CATALOG) {
    const features = loadFeatures({ [meta.envKey]: "true" });
    expect(isFeatureActive(features, meta.key)).toBe(true);
  }
});
```

### 5. Conditional module wiring — `src/core/app/app.module.ts`

Use `conditionalImport` so the module pulls in **zero runtime cost**
when off:

```typescript
import { NotificationsModule } from "../notifications/notifications.module.js";

@Module({
  imports: [
    // ... existing
    ...conditionalImport(features, "notifications", NotificationsModule),
  ],
})
```

If your feature provides a global guard/interceptor:

```typescript
providers: [
  // ... existing
  ...(features.notifications.enabled
    ? [{ provide: APP_INTERCEPTOR, useClass: NotificationsInterceptor }]
    : []),
],
```

### 6. Service-status (only if external service) — `src/core/dx/service-status.ts`

Skip if the feature is purely in-process. If it talks to a sibling
container (PowerSync, Mailpit pattern), add to the candidate list:

```typescript
if (input.features.notifications.enabled && v.NOTIFICATIONS_URL) {
  candidates.push({
    id: "notifications",
    label: "Notifications Service",
    category: "feature",
    probeUrl: v.NOTIFICATIONS_URL,
    href: v.NOTIFICATIONS_URL,
  });
}
```

> **Gate it on `features.<key>.enabled` AND the URL** — not just one.
> Otherwise the service tile shows up even when the feature is off.

### 7. Diagnostics report — `src/core/dx/diagnostics.ts`

```typescript
export interface DiagnosticsFeaturesReport {
  // ... existing
  notifications: boolean;
}

// in summariseFeatures():
return {
  // ... existing
  notifications: features.notifications.enabled,
};
```

### 8. Schema concat (only if Prisma models exist) — `src/core/setup/schema-concat.ts`

```typescript
const TOGGLEABLE_FEATURES: ToggleableFeatureKey[] = [
  // ... existing
  "notifications",
];
```

Then add `prisma/features/notifications.prisma` with the model.

### 9. Setup wizard (optional) — `src/core/setup/setup-wizard.ts`

If `bun run setup` should ask about your feature:

```typescript
export interface WizardAnswers {
  // ... existing
  notifications: boolean;
}

// in planSetup():
features.notifications = { enabled: answers.notifications };

// in renderEnvExample() — if your feature requires runtime config:
if (answers.notifications) {
  lines.push("NOTIFICATIONS_WEBHOOK_URL=");
}
```

Then regenerate `.env.example`:

```bash
bun run scripts/regen-env-example.ts   # if that script exists
# OR copy the output of buildDefaultEnvExample() into .env.example
```

### 10. Story tests

| Test file                                     | Add what                                         |
| --------------------------------------------- | ------------------------------------------------ |
| `tests/stories/features.story.test.ts`        | Default value + ENV override case                |
| `tests/stories/feature-catalog.story.test.ts` | Already covers the envKey roundtrip — just rerun |
| `tests/stories/diagnostics.story.test.ts`     | New field in the features-section assertion      |
| `tests/stories/dev-hub.story.test.ts`         | If you added a navigation link                   |
| `tests/stories/schema-concat.story.test.ts`   | If you added a Prisma model                      |

### 11. Quality gates

```bash
bun run lint && \
bun run format && \
bun run test:types && \
bun run test:unit && \
bun run test:e2e && \
bun run test:coverage && \
bun run build
```

All six must pass before commit.

---

## Verifying live in the dev hub

1. `bun run dev` — Dev Hub opens at `/dev`
2. Sidebar → **Features** → your card should appear under its category
   with the OFF chip, full description, and the `FEATURE_*_ENABLED`
   env-var hint
3. Flip the lime toggle → page shows "Restarting server…" overlay
4. Server respawns (`scripts/dev.ts` watches `.env`), page reloads
5. Card now shows ON chip, services tile appears (if applicable)
6. `/hub/diagnostics` reflects the new flag in the active-features matrix

---

## Defaults playbook

| Pattern                      | Default | Why                                                                                             |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| Cross-cutting infrastructure | ON      | Multi-Tenancy, Files, Email, Observability, Jobs, Rate-Limit, Idempotency. Most apps want them. |
| External integration         | OFF     | Webhooks, PowerSync, MCP, Realtime, Geo. Costs runtime + extra config.                          |
| Optional security hardening  | OFF     | Field Encryption — needs KEK setup, opt-in.                                                     |

---

## Don't

- **Don't read `process.env.FOO_ENABLED` directly** — `loadFeatures()` is the only entry point.
- **Don't skip the catalog entry** — the toggle won't show up in the UI.
- **Don't gate service-status only on the URL** — must AND the feature flag, otherwise the tile lights up when off.
- **Don't forget the regression test** — `feature-catalog.story.test.ts` saves you from envKey/section-key drift.
- **Don't import the module unconditionally** — use `conditionalImport(features, key, Module)` so OFF means zero runtime cost.
- **Don't hard-code feature checks in `src/core/`** — inject the parsed `Features` object as a Nest provider.

---

## Footprint zero when off

A feature toggle that's `enabled: false` produces **no** runtime cost:

- Module not imported → no DI overhead, no boot time
- ENV vars not required → setup wizard skips them
- Schema not concatenated → no Prisma migrations needed
- Dev-Hub link absent → no UI clutter
- Service-status tile absent → no probe traffic

If your feature still costs CPU/memory when off, you've wired it
unconditionally somewhere. Hunt that spot down.
