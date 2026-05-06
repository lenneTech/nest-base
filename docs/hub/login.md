# Hub Login

The Hub is the developer and operator cockpit for nest-base. It is
served as a React 19 SPA at `/` in every stage (development, staging,
production) — there is no separate `/dev` path anymore.

---

## Demo logins

After `bun run prisma:migrate && bun run seed` you have three ready-to-use
accounts in the `lenne` tenant:

| Email | Password | Role |
|---|---|---|
| `system-admin@lenne.tech` | `system-admin` | System Admin — CASL full bypass |
| `admin@lenne.tech` | `admin` | Admin — `manage` on every resource in the tenant |
| `user@lenne.tech` | `user` | User — `read` on tenant resources, `update` own profile |

The seed is **fully idempotent** — running it again never creates duplicates.

---

## New-device confirmation flow

Better-Auth enforces a **new-device email confirmation** step. On the
first sign-in from an unfamiliar browser:

1. The sign-in attempt succeeds in the API but the session is marked
   `pending-device-verification`.
2. Better-Auth sends a confirmation link to the account's email.
3. The user must click the link before the Hub grants full access.

In local development `docker compose up -d mailpit` exposes a catch-all
inbox at `http://localhost:8025` — all outbound mail is captured there
so you never need a real email address for dev logins.

---

## Resetting a password

Use the CLI helper to reset a Hub user's password without going through
the email flow:

```bash
bun run hub:reset-password
```

The script (`scripts/hub-reset-password.ts`) prompts for the email
address and the new password, then hashes and persists it directly via
the Prisma adapter — no email round-trip required.

---

## Security notes

- Sessions are `httpOnly` + `Secure` + `SameSite=Lax` cookies signed by
  `BETTER_AUTH_SECRET`.
- The Hub login page itself (`/`) is a public route; every page behind it
  (`/hub/*`, `/admin/*`) requires an active session.
- In production, set `NODE_ENV=production` — this 404s all
  developer-only routes (`/hub/*` sidecars, `/admin/*` mutation
  endpoints) while leaving `/` and `/errors` reachable.
