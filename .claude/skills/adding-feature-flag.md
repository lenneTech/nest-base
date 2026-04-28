# Adding a Feature Flag

`features.ts` is the single source of truth for runtime module-
activation. Every conditional module reads `FeaturesSchema.parse(...)`
— never hard-code `if (process.env.FOO_ENABLED === 'true')`.

## The shape

`src/core/features/features.ts` exports `FeaturesSchema` (Zod). It
covers:

- **Always-on cores** — auth, permissions, audit, errorCodes, health,
  request-context, output-pipeline (no toggle)
- **Selective auth methods** — `authMethods.{emailPassword, twoFactor,
  passkey, apiKeys, socialProviders}`
- **Multi-tenancy** — `multiTenancy.{enabled, rls, headerName}`
- **File handling** — `files.{enabled, storageDefault, tus, transformations}`
- **Email** — `email.{enabled, provider}`
- **Toggle-only features** — `webhooks`, `search`, `realtime`,
  `powerSync`, `mcp`, `fieldEncryption`, `geo`, `rateLimit`,
  `idempotency`, `observability`, `jobs`

## Adding a new feature toggle

Say you're adding a `notifications` feature.

### 1. Add the schema entry

Edit `src/core/features/features.ts`:

```typescript
const Notifications = togglableDefault(false);  // default off
// ... at the bottom of FeaturesSchema:
export const FeaturesSchema = z.object({
  // ... existing fields
  notifications: Notifications.default(() => Notifications.parse({})),
});
```

If your feature needs more than `enabled`, define a custom sub-schema:

```typescript
const NotificationsSchema = z.object({
  enabled: z.boolean().default(false),
  channels: z.array(z.enum(['email', 'webhook', 'realtime'])).default([]),
  retentionDays: z.number().int().positive().default(30),
});
```

### 2. Update the `ToggleableFeatureKey` union

Same file:

```typescript
export type ToggleableFeatureKey =
  | 'multiTenancy'
  | 'files'
  | 'email'
  | 'webhooks'
  | 'search'
  | 'realtime'
  | 'powerSync'
  | 'mcp'
  | 'fieldEncryption'
  | 'geo'
  | 'rateLimit'
  | 'idempotency'
  | 'observability'
  | 'jobs'
  | 'notifications';   // ← new
```

### 3. Wire into the diagnostics report

Edit `src/core/dx/diagnostics.ts` — `summariseFeatures()` flattens the
toggle map. Add the new flag:

```typescript
return {
  // ...
  notifications: features.notifications.enabled,
};
```

And bump the `DiagnosticsFeaturesReport` type accordingly.

### 4. Wire into the dev-hub

If your feature has an admin UI, add a link to `src/core/dx/dev-hub.ts`:

```typescript
if (input.features.notifications.enabled) {
  links.push({
    label: 'Notifications Inspector',
    url: '/admin/notifications',
    category: 'async',
  });
}
```

### 5. Wire into the schema-concat (if Prisma model exists)

Edit `src/core/setup/schema-concat.ts` — add `'notifications'` to the
`TOGGLEABLE_FEATURES` array. Add `prisma/features/notifications.prisma`
with the schema.

### 6. Wire into the setup wizard (optional)

Edit `src/core/setup/setup-wizard.ts` if you want the wizard to ask
about your feature:

```typescript
export interface WizardAnswers {
  // ...
  notifications: boolean;
}

// in planSetup():
features.notifications = { enabled: answers.notifications };

// in renderEnvExample():
if (answers.notifications) {
  lines.push('NOTIFICATIONS_TOPIC=');
}
```

### 7. Tests

Story tests for each touch point:

- `tests/stories/features.story.test.ts` — add cases for the new
  default + override
- `tests/stories/diagnostics.story.test.ts` — add to the
  features-section assertions
- `tests/stories/dev-hub.story.test.ts` — add the new link assertion
  (if applicable)
- `tests/stories/schema-concat.story.test.ts` — add to the all-toggleable
  assertion

## Using the flag at runtime

In `AppModule` (or wherever the project's root composes):

```typescript
import { features } from '../config/features.js';

@Module({
  imports: [
    ...(features.notifications.enabled ? [NotificationsModule] : []),
    // … other modules
  ],
})
export class AppModule {}
```

In a service:

```typescript
constructor(private readonly features: Features) {}

doThing() {
  if (this.features.notifications.enabled) {
    // …
  }
}
```

## Defaults

- **Default OFF** for opt-in features (PowerSync, MCP, Webhooks,
  Search, Realtime, Geo, Field-Encryption, Notifications).
- **Default ON** for cross-cutting infrastructure (Multi-Tenancy,
  Files, Email, Observability, Jobs, Rate-Limit, Idempotency).

## Don't

- **Don't read `process.env.FOO_ENABLED` directly.** The Zod schema
  is the single source of truth, including ENV parsing (handled by
  `loadFeatures()`).
- **Don't hard-code feature checks in `src/core/`.** Inject the
  parsed `Features` object as a Nest provider (`FEATURES_PROVIDER`
  injection token).
- **Don't add a feature flag without updating the diagnostics report
  + dev-hub.** Drives downstream tooling (CLI dashboards, MCP-tool
  consumers) to know your flag exists.

## Footprint zero when off

A feature toggle that's `enabled: false` should produce *no* runtime
overhead:

- Module not imported → no DI overhead, no boot time
- ENV vars not required → setup wizard skips them
- Schema not concatenated → no Prisma migrations needed
- Dev-Hub link absent → no UI clutter

If your feature still costs CPU/memory when off, you've wired it
wrong — fix the gating.
