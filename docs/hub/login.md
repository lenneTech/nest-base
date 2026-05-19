# Hub authentication (Better-Auth only)

The operator cockpit (`/`, `/hub/*`, `/admin/*`) uses **one** auth system:
[Better-Auth](https://better-auth.com) email/password sessions — the same as the
rest of the API.

There is **no** separate Hub operator password or `hub.session` cookie anymore.

---

## Sign-in flow

1. Open `/` (or any protected `/hub/*` / `/admin/*` URL — you are redirected to `/`).
2. Sign in with email + password (`POST /api/auth/sign-in/email`, session cookie).
3. The SPA checks `GET /hub/portal-access.json` (requires `read DevHub`).
4. On success you land on `/hub` (or the page you requested).

**After setup** (`bun run setup` runs migrate + seed by default; or
`bun run setup --bootstrap` on an existing `.env`):

| Email | Password | Hub (`read DevHub`) | Admin panel |
| --- | --- | --- | --- |
| `system-admin@lenne.tech` | `system-admin` | yes (`manage:all`) | yes |
| `admin@lenne.tech` | `admin` | yes | yes |
| `user@lenne.tech` | `user` | **no** | **no** |

The demo **User** role is for app tenants, not the operator Hub. Use **Admin** or
**System Admin** for cockpit access.

---

## CASL subjects

| Subject | Typical use |
| --- | --- |
| `DevHub` | `/hub/*` cockpit, diagnostics, feature toggles, logs, … |
| `User`, `TenantAdmin`, `Role`, … | `/admin/*` CRUD and inspectors |

Rules are seeded in `src/core/setup/seed-plan.ts`.

**Breaking change (Hub password removed):** if your database was seeded before the
Better-Auth-only Hub, run `bun run seed` again after `git pull` so the Admin policy
gains `read DevHub` and tenant-admin subjects. Seeding is idempotent.

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
