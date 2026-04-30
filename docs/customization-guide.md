# Customization Guide

This server is a *template*. Many projects share the same core; each project
adds its own resources on top. The split lives in two folders:

| Path | Owner | Edited by |
|------|-------|-----------|
| **`src/core/`** | Template | Template maintainers (PRs upstream) |
| **`src/modules/`** | Project | You (freely) |
| **`src/shared/`** | Both | Template maintainers; types must stay back-compat |

## The boundary

- `src/core/` is **the synchronised template area**. Don't edit it casually.
  Improvements should land upstream via `bun run sync:to-template` so every
  project benefits — see the
  [Core-Contribution-Guide](./core-contribution-guide.md).
- `src/modules/` is **the project-specific area**. Add your domain models,
  services, controllers, jobs, and integrations here. Nothing in `src/modules/`
  is touched by the template sync.

## Activating optional features

The template ships every feature behind a flag. Edit `src/config/features.ts`
(written by `bun run setup`) — it imports `FeaturesSchema` from the core and
parses your selection at boot, so a typo is caught before any code runs:

```typescript
import { FeaturesSchema } from '../core/features/features.js';

export const features = FeaturesSchema.parse({
  multiTenancy: { enabled: true },
  email: { enabled: true, provider: 'brevo' },
  webhooks: { enabled: true },
  search: { enabled: false },
  // …
});
```

Toggle a feature off — its module is not loaded, its env vars aren't required,
its Prisma models stay out of the schema. Footprint zero.

## Adding a new resource

A new resource lives entirely in `src/modules/<resource>/`:

1. **Model** — `prisma/features/<resource>.prisma` (or `prisma/schema.prisma`
   for project-required models). Run `bun run prepare:schema && bunx prisma
   migrate dev` to apply.
2. **Service** — `src/modules/<resource>/<resource>.service.ts`. Inject
   `PrismaService`, the relevant repo helpers, `PermissionService`, anything
   else from `src/core/`.
3. **Controller** — `src/modules/<resource>/<resource>.controller.ts`. Use
   `@Can()` from `src/core/permissions/can.guard.ts` to gate handlers; use
   Zod schemas from `src/core/validation/` for DTOs.
4. **Module** — `src/modules/<resource>/<resource>.module.ts`. Register the
   service + controller; export anything other modules might inject.
5. **Wire** — add the module to `AppModule` (or a sub-module that already
   aggregates project modules).

The `src/core/` codebase already provides `PrismaService`, `PermissionService`,
the output pipeline, the request-context middleware, the rate-limiter, the
audit-log helpers, and the realtime/webhook integrations — everything a
typical resource needs. You shouldn't be reaching outside `src/modules/` for
domain code.

## Branding

The look-and-feel of every Dev-Portal page, every transactional email, and
the OpenAPI document title is driven by a **single brand config** — a JSON
file under the source tree. Two files cooperate:

| Path | Owner | Survives sync? |
|------|-------|----------------|
| `src/modules/branding/brand.json` | Project (committed) | Yes |
| `src/core/branding/brand.default.json` | Template | No (synced upstream) |

Lookup precedence: project overlay → template default → schema built-in.

### Editing the brand

Three options, in order of safety:

1. **Through the UI** at `/dev/brand` — the page reads `/dev/brand.json`
   and writes the project overlay via `POST /dev/brand`. The dev runner's
   watcher detects the file change and restarts the API so OpenAPI title,
   Better-Auth issuer, and email defaults pick up the new values.
2. **Direct edit** of `src/modules/branding/brand.json`. The file is in
   git — review-friendly diff, no surprise rollbacks.
3. **Reset** with `POST /dev/brand/reset` (or delete the file manually).
   Falls back to the template default.

### Schema (subset)

```json
{
  "name": "Acme",
  "shortName": "acme",
  "tagline": "Acme runs on this server",
  "primaryColor": "#ff00aa",
  "primaryColorInk": "#ffffff",
  "backgroundColor": "#020203",
  "surfaceColor": "#06070a",
  "textColor": "#e4e4e7",
  "mutedTextColor": "#71717a",
  "fromEmail": "no-reply@acme.test",
  "legalEntity": "Acme Holdings GmbH",
  "supportEmail": "support@acme.test",
  "supportUrl": "https://acme.test/support"
}
```

Hex colors must be 6-digit (`#RRGGBB`); shorthand `#fff` is rejected for
deterministic CSS-var generation. Email and URL fields are validated by
the same Zod schema (`src/core/branding/brand-schema.ts`) on every load
and on every `POST /dev/brand` write.

### Where the brand surfaces

- **Dev-Portal SPA** — `--accent`, `--bg`, `--surface-1`, `--fg`,
  `--fg-dim` `:root` overrides injected by the shell HTML before the
  static `tokens.css`. The brand name appears in `<title>` and in the
  sidebar. `window.__BRAND__` is inlined for the SPA so the first paint
  is correct.
- **Transactional emails** — `Barebone` layout reads `brand.primaryColor`
  for the dot logo + CTA buttons, `brand.legalEntity` + `brand.supportEmail`
  for the footer. The legacy EJS templates take the same brand object.
- **OpenAPI** — `info.title = brand.name`,
  `info.description = brand.tagline`. Scalar UI and any kubb-generated
  SDK pick this up automatically.
- **Better-Auth** — TOTP `issuer` + Passkey `rpName` follow `brand.name`
  so authenticator apps and WebAuthn prompts say "Acme" instead of the
  template default.
- **EmailService** — `defaultFrom` precedence is env (`SMTP_FROM`) →
  `brand.fromEmail` → final placeholder.

### Service credentials are NOT in `brand.json`

`SMTP_*`, `BREVO_API_KEY`, `MAXMIND_LICENSE_KEY`, etc. live in `.env`
(gitignored). The brand file is committed in git — putting secrets there
would leak them on every push. Edit credentials in `.env` directly; the
dev runner watches that file too and restarts on save.

## Project-specific environment variables

Add them to `.env.example` and parse them via `src/core/config/env.ts` if you
want them validated alongside the framework's own env. Project-local config
modules live in `src/modules/<resource>/<resource>.config.ts`.

## When you *do* need a core change

It happens — a generic capability you're tempted to copy-paste between
projects. The right move is a PR to the template; see
[Core-Contribution-Guide](./core-contribution-guide.md). Editing `src/core/`
in place works for an emergency hotfix, but the next `sync:from-template`
will overwrite it. Record the divergence in `OPEN_QUESTIONS.md` so future-you
sees it.
