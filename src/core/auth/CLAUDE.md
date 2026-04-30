# `src/core/auth/` — agent guide

Authentication subsystem built on **Better-Auth 1.6**. Owns the factory,
the controller mount, the session middleware, the rate-limit middleware,
plus PowerSync's JWT bridge.

```
auth/
├── better-auth.ts                     ← buildBetterAuth(input) factory
├── better-auth.module.ts              ← NestJS module + DI
├── better-auth.controller.ts          ← /api/auth/* mount (toNodeHandler)
├── better-auth-config.ts              ← mount-path + Zod schema
├── better-auth-plugins.ts             ← features → plugin-name mapping
├── better-auth-email-hooks.ts         ← pure planner: hook payload → sendTemplate args
├── better-auth-email-hooks.runner.ts  ← thin runner around the planner
├── email-verification.ts              ← token + link helpers
├── session-middleware.ts              ← BetterAuthSessionMiddleware
├── rate-limit.ts                      ← per-route limit table
├── api-keys/                          ← `/api/v1/api-keys` resource
├── powersync*.ts                      ← PowerSync JWT bridge
└── auth-scenarios.ts                  ← named auth scenarios for docs/tests
```

## Better-Auth → EmailService wiring

`BetterAuthModule` injects `EmailService` and passes it as
`buildBetterAuth({ emailHooks: { sender, appName } })`. The factory
attaches three hook closures driven by a shared
`createEmailHookRunner()`:

| Better-Auth hook                           | Template             | Vars                                                  |
| ------------------------------------------ | -------------------- | ----------------------------------------------------- |
| `emailVerification.sendVerificationEmail`  | `email-verification` | `recipientName`, `appName`, `verificationUrl`         |
| `emailAndPassword.sendResetPassword`       | `password-reset`     | `recipientName`, `appName`, `resetUrl`                |
| `emailVerification.afterEmailVerification` | `welcome`            | `recipientName`, `appName`                            |
| (manual call) `runner.sendInvitation()`    | `invitation`         | `recipientName`, `appName`, `acceptUrl`, `senderName` |

The `invitation` template fires when project code calls the runner
directly — the framework-managed Better-Auth instance does not own
the invitation flow itself (admin / org plugins land in a follow-up).

### Variable resolution

| Variable                                     | Source (in priority order)                                           |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `recipientName`                              | `user.name` → `user.displayName` → `email.split("@")[0]` → `there`   |
| `appName`                                    | `process.env.APP_NAME` → `BrandConfig.appName` (default `nest-base`) |
| `verificationUrl` / `resetUrl` / `acceptUrl` | the `url` field Better-Auth supplies on the hook payload             |
| `senderName` (invitation)                    | runner caller → `"A teammate"` fallback                              |

### Locale resolution

Today: hardcoded `"en"`. Issue `#011 (i18n RFC)` will surface the
user's locale; until then templates use the default-locale variant
(`<name>.tsx`) and the renderer falls back gracefully if a locale
suffix is requested but missing.

### Failure semantics

The runner **never throws back into the auth flow**. SMTP outages,
template rendering errors, and planner-level config errors are all
caught and routed to the configurable `onError` sink (defaults to the
NestJS `Logger` channel `BetterAuthEmailHooks`). The user-facing
sign-up / reset / verify endpoint stays unblocked. The
[outbox slice](../../docs/architecture.md) (issue #11) will replace
the inline `await` with an enqueue-and-return path so a failed mail
queues up for retry instead of just logging.

### Testing surfaces

| Layer                        | Test file                                                    |
| ---------------------------- | ------------------------------------------------------------ |
| Pure planner                 | `tests/stories/better-auth-email-hooks.story.test.ts`        |
| Thin runner (error handling) | `tests/stories/better-auth-email-hook-runner.story.test.ts`  |
| Factory wiring (in-memory)   | `tests/stories/better-auth-email-hooks-wiring.story.test.ts` |
| Full e2e (boots app + DB)    | `tests/better-auth-email-hooks.e2e-spec.ts`                  |

## Adding a new hook (template)

1. Drop the `.tsx` file under `src/core/email/templates/<name>.tsx`
   (or `src/modules/email/templates/` for project-specific). Export a
   `<name>Meta` object with a `subject(vars)` factory and a default
   component — see [`src/core/email/CLAUDE.md`](../email/CLAUDE.md).
2. Extend `EmailHookKind` + `EmailHookInput` in
   `better-auth-email-hooks.ts` with the new variant. Update the
   switch in `buildEmailHookPayload()` to assemble the vars object.
3. Add a method to the runner if Better-Auth fires a dedicated hook
   (e.g. `magicLink.sendMagicLink`) — wire the closure inside
   `buildBetterAuth()` next to the existing ones.
4. Story-test the planner (red first), runner-test the propagation,
   add an e2e if a real Better-Auth flow lights up the path.
5. Update the table above.

## Hard rules

- The planner is pure — no I/O, no env reads outside `resolveAppName(env)`.
- The runner never throws into Better-Auth. Failures go through `onError`.
- `.js` extension on every relative import (ESM contract).
- Never bypass the planner — the canonical `{ template, to, vars }`
  shape is the testable choke-point.
