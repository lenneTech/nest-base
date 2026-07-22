# Hub authentication (Better-Auth only)

The operator cockpit (`/`, `/hub/*`, `/admin/*`) uses **one** auth system:
[Better-Auth](https://better-auth.com) email/password sessions — the same as the
rest of the API.

There is **no** separate Hub operator password or `hub.session` cookie anymore.

---

## Sign-in flow

1. Open `/` (or any protected `/hub/*` / `/admin/*` URL — you are redirected to `/`).
2. Sign in with email + password (`POST /api/auth/sign-in/email`, session cookie).
3. The SPA calls `bootstrapHubOperatorSession()` (Better-Auth `set-active`
   for the operator's organization) when multi-tenancy is enabled.
4. The SPA checks `GET /hub/portal-access.json` (`hub` + `tenantAdmin` flags, plus
   `workstation` — `false` outside development, which hides workstation-tier nav
   entries such as Files/Migrations/Coverage/Tests/ERD/Emails and the testers).
5. On success you land on `/hub` (system admin) or `/admin/*` (tenant admin).

**After setup** (`bun run setup` runs migrate + seed by default), demo accounts are
created with deterministic roles. **`bun run seed` prints emails and passwords to the
terminal only** — the Hub login screen and error pages never name accounts (defense
against account enumeration).

| Capability | Who (role) |
| --- | --- |
| Hub (`/hub/*`) | System Admin (`manage:all`) |
| Admin panel (`/admin/*`) | System Admin or tenant Admin |
| Neither | demo User (app tenant) |

---

## CASL subjects

| Subject | Typical use |
| --- | --- |
| `Hub` | `/hub/*` cockpit, diagnostics, feature toggles, logs, … |
| `User`, `TenantAdmin`, `Role`, … | `/admin/*` CRUD and inspectors |

Rules are seeded in `src/core/setup/seed-plan.ts`.

After permission changes, run `bun run seed` (or `bun run reset`) and restart
`bun run dev` so in-memory CASL caches refresh.

---

## Development vs production

| Surface | `NODE_ENV=development` | Other environments |
| --- | --- | --- |
| Better-Auth sign-in | required for `/hub/*`, `/admin/*` | same |
| Hub JSON/HTML routes | `assertDev()` — **404** outside development | 404 |
| `/errors`, `/openapi` | public per existing policy | per `OPENAPI_REQUIRE_AUTH` |

Local `bun run dev` behaves like staging regarding **login** — you always sign in
with a seed operator account. Only the dev-only route surface stays development-gated.

---

## Mail / new device

Better-Auth may require device confirmation on first login from a new browser.
Capture mail locally:

```bash
docker compose up -d mailpit
```

Inbox: `http://localhost:8025`

---

## Sidebar layout

1. **Übersicht** — cockpit, diagnostics, features, brand, coverage, tests  
2. **Laufzeit** — logs, traces, queries, migrations, jobs, cron, email outbox  
3. **API & Docs** — Scalar, OpenAPI, routes, errors, ERD, email tools, Prisma Studio  
4. **Admin** — users, tenants, RBAC, inspectors, file manager  

`/admin/jobs` redirects to `/hub/jobs`.
