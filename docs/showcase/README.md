# Hub Showcase

Screenshots of every developer-facing surface, captured on
post-shadcn-migration `main` (`ac49216`). Re-shoot these whenever the
UI moves visibly — they ship in the README so a fresh contributor sees
the cockpit before they boot the server.

Tech under the hood (every page below): React 19 SPA + react-router-dom 7
+ shadcn/ui (Radix) primitives + Tailwind CSS 4 + lucide-react icons +
sonner toasts + TanStack Query — vendored under
[`src/core/dx/clients/`](../../src/core/dx/clients/CLAUDE.md).

## Pages

### `/hub/*` — developer cockpit

| Page                                                                                | Desktop (1440 × 900)                                                                                 | Mobile (390 × 844)                                                                                |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`/hub`](../../src/core/dx/clients/pages/DevHubLandingPage.tsx) — Cockpit landing   | [![dev landing desktop](screenshots/dev-landing-desktop.png)](screenshots/dev-landing-desktop.png)   | [![dev landing mobile](screenshots/dev-landing-mobile.png)](screenshots/dev-landing-mobile.png)   |
| [`/hub/features`](../../src/core/dx/clients/pages/FeaturesPage.tsx) — toggles       | [![features desktop](screenshots/dev-features-desktop.png)](screenshots/dev-features-desktop.png)    | [![features mobile](screenshots/dev-features-mobile.png)](screenshots/dev-features-mobile.png)    |
| [`/hub/coverage`](../../src/core/dx/clients/pages/CoveragePage.tsx) — Vitest report | [![coverage desktop](screenshots/dev-coverage-desktop.png)](screenshots/dev-coverage-desktop.png)    | [![coverage mobile](screenshots/dev-coverage-mobile.png)](screenshots/dev-coverage-mobile.png)    |
| [`/hub/jobs`](../../src/core/dx/clients/pages/JobsPage.tsx) — queues + jobs         | [![jobs desktop](screenshots/dev-jobs-desktop.png)](screenshots/dev-jobs-desktop.png)                | [![jobs mobile](screenshots/dev-jobs-mobile.png)](screenshots/dev-jobs-mobile.png)                |
| [`/hub/migrations`](../../src/core/dx/clients/pages/MigrationsPage.tsx) — Prisma    | [![migrations desktop](screenshots/dev-migrations-desktop.png)](screenshots/dev-migrations-desktop.png) | [![migrations mobile](screenshots/dev-migrations-mobile.png)](screenshots/dev-migrations-mobile.png) |
| [`/hub/email-builder`](../../src/core/dx/clients/pages/EmailBuilderPage.tsx)        | [![email builder desktop](screenshots/dev-email-builder-desktop.png)](screenshots/dev-email-builder-desktop.png) | [![email builder mobile](screenshots/dev-email-builder-mobile.png)](screenshots/dev-email-builder-mobile.png) |
| [`/hub/email-preview`](../../src/core/dx/clients/pages/EmailPreviewPage.tsx)        | [![email preview desktop](screenshots/dev-email-preview-desktop.png)](screenshots/dev-email-preview-desktop.png) | [![email preview mobile](screenshots/dev-email-preview-mobile.png)](screenshots/dev-email-preview-mobile.png) |

### `/admin/*` — operator surfaces

| Page                                                                                  | Desktop (1440 × 900)                                                                                                   | Mobile (390 × 844)                                                                                                  |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`/admin/permissions/test`](../../src/core/dx/clients/pages/PermissionTesterPage.tsx) | [![permission tester desktop](screenshots/admin-permissions-test-desktop.png)](screenshots/admin-permissions-test-desktop.png) | [![permission tester mobile](screenshots/admin-permissions-test-mobile.png)](screenshots/admin-permissions-test-mobile.png) |
| [`/admin/webhooks`](../../src/core/dx/clients/pages/WebhookInspectorPage.tsx) — 3-col | [![webhooks desktop](screenshots/admin-webhooks-desktop.png)](screenshots/admin-webhooks-desktop.png)                  | [![webhooks mobile](screenshots/admin-webhooks-mobile.png)](screenshots/admin-webhooks-mobile.png)                  |
| [`/admin/realtime`](../../src/core/dx/clients/pages/RealtimeInspectorPage.tsx) — tabs | [![realtime desktop](screenshots/admin-realtime-desktop.png)](screenshots/admin-realtime-desktop.png)                  | [![realtime mobile](screenshots/admin-realtime-mobile.png)](screenshots/admin-realtime-mobile.png)                  |
| [`/admin/audit`](../../src/core/dx/clients/pages/AuditBrowserPage.tsx)                | [![audit desktop](screenshots/admin-audit-desktop.png)](screenshots/admin-audit-desktop.png)                           | [![audit mobile](screenshots/admin-audit-mobile.png)](screenshots/admin-audit-mobile.png)                           |

### Shared JSON viewer

| Page                                                                       | Desktop (1440 × 900)                                                                  | Mobile (390 × 844)                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`/errors`](../../src/core/dx/clients/pages/ErrorsPage.tsx) — error catalog | [![errors desktop](screenshots/errors-desktop.png)](screenshots/errors-desktop.png)   | [![errors mobile](screenshots/errors-mobile.png)](screenshots/errors-mobile.png)   |
| [`/api/openapi`](../../src/core/dx/clients/pages/OpenApiPage.tsx) — OpenAPI | [![openapi desktop](screenshots/openapi-desktop.png)](screenshots/openapi-desktop.png) | [![openapi mobile](screenshots/openapi-mobile.png)](screenshots/openapi-mobile.png) |

## Reproducing

The capture is **opt-in** — Playwright + Chromium are heavyweight
downloads that we keep out of CI, and the screenshots themselves are
binary blobs that don't belong in every PR. Re-run only when the UI
has visibly moved.

```bash
# 1. boot Postgres (once per machine)
docker compose up -d postgres

# 2. run migrations + start the dev server in another shell
bun run prisma:migrate
bun run dev

# 3. one-time Playwright install (Chromium ~150 MB)
bun add -d playwright
bunx playwright install chromium

# 4. point the script at the dev URL the runner printed (skip if 3000)
#    and capture all 13 pages × 2 viewports = 26 PNGs:
BASE_URL=http://localhost:4267 bun run docs:screenshots
```

The script ([`scripts/take-showcase-screenshots.ts`](../../scripts/take-showcase-screenshots.ts))
signs up a deterministic `screenshot-bot@example.com` account so the
`/admin/*` surfaces (which require an authenticated session) render
correctly. The cookie stays inside the Playwright browser context —
nothing is persisted between runs.

### Auth and `Secure` cookies

Better-Auth picks `__Secure-`-prefixed cookies whenever `APP_BASE_URL`
starts with `https://`. Headless Chromium silently drops those on a
plain-`http://` connection, which surfaces as a 401 from `/admin/*`.

For a local screenshot pass, set `APP_BASE_URL=http://localhost:<port>`
in `.env` (matching whatever port the dev runner announced) before you
boot the server. Restore the original `https://api.<project>.localhost`
setting once you're done — it's the right value for everyday work
because portless terminates TLS on the loopback host.

### Filename contract

| Slug                       | Source page                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| `dev-landing`              | `/hub` dashboard                                                     |
| `dev-features`             | `/hub/features`                                                      |
| `dev-coverage`             | `/hub/coverage`                                                      |
| `dev-jobs`                 | `/hub/jobs`                                                          |
| `dev-migrations`           | `/hub/migrations`                                                    |
| `dev-email-builder`        | `/hub/email-builder` gallery                                         |
| `dev-email-preview`        | `/hub/email-preview`                                                 |
| `admin-permissions-test`   | `/admin/permissions/test`                                            |
| `admin-webhooks`           | `/admin/webhooks` (3-column inspector)                               |
| `admin-realtime`           | `/admin/realtime` (Sockets/Channels/Events tabs)                     |
| `admin-audit`              | `/admin/audit`                                                       |
| `errors`                   | `/errors` JSON viewer                                                |
| `openapi`                  | `/api/openapi` JSON viewer                                           |

Each slug emits two files: `<slug>-desktop.png` (1440 × 900) and
`<slug>-mobile.png` (390 × 844). Keep these names — the README + the
table above embed them by path.
