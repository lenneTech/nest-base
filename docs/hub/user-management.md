# User Management UI

**Route:** `/hub/admin/users`  
**Issue:** #86  
**Backend path:** `src/core/dx/user-admin.controller.ts`  
**Frontend path:** `src/core/dx/clients/pages/UsersAdminPage.tsx`

---

## Overview

The User Management page lets operators search, inspect, ban, unban, and
revoke sessions for every user in the system. All write actions proxy to
the Better-Auth admin API through NestJS endpoints gated by
`@Can("manage", "User")`.

---

## User list

### Search bar

A debounced text input (300 ms) filters by email or name:

```
GET /hub/admin/users/list.json?q=<term>
```

Returns a `UsersListResponse` with `users[]` and `total`.

### Table columns

| Column | Notes |
|--------|-------|
| **E-Mail** | monospace, clickable row opens detail sheet |
| **Name** | display name or `—` |
| **Verifiziert** | `Ja` / `Nein` badge (email verification state) |
| **Gesperrt** | `Ja` (destructive badge) / `Nein` when banned |
| **Erstellt** | formatted date (de-DE locale) |
| **Sitzungen** | active session count |
| **Aktionen** | three-dot dropdown with Sperren / Entsperren / Sitzungen widerrufen |

Clicking any row (except the actions cell) opens the **User detail sheet**.

### Row actions (dropdown)

Available actions depend on the user's current state:

| Action | Available when | Endpoint |
|--------|---------------|----------|
| Sperren | not banned | `POST /hub/admin/users/:id/ban` |
| Entsperren | banned | `POST /hub/admin/users/:id/unban` |
| Sitzungen widerrufen | always | `POST /hub/admin/users/:id/revoke-sessions` |

Every destructive action requires a confirmation dialog (`ConfirmDialog`)
before the mutation fires.

---

## User detail sheet

Clicking a row slides in a right-side sheet panel (480–560 px wide).
The sheet fetches full user data:

```
GET /hub/admin/users/:id.json
```

### Action buttons

Two primary action buttons appear at the top of the sheet:

- **Sperren** (destructive) / **Entsperren** (outline) — toggles the ban state
- **Sitzungen widerrufen** — revokes all active sessions

Both are disabled while a mutation is in flight.

### Tabs

**Übersicht** — a definition list with all user fields:

| Field | Notes |
|-------|-------|
| ID | UUID (monospace, wraps) |
| Name | display name |
| E-Mail | wrapped email |
| Verifiziert | `Ja` / `Nein` badge |
| Gesperrt | `Ja` (destructive) / `Nein` badge |
| Erstellt | formatted date |
| Aktualisiert | formatted date |

**Sitzungen** — a table of all active sessions:

| Column | Notes |
|--------|-------|
| Erstellt | session start time |
| IP | IP address or `—` |
| Browser | truncated user-agent string |

**Konten** — a table of linked OAuth / credential accounts:

| Column | Notes |
|--------|-------|
| Anbieter | `providerId` (e.g. `credential`, `google`) |
| Konto-ID | provider-specific account identifier |
| Erstellt | account link date |

---

## How to revoke all sessions for a user

1. Find the user via the search bar.
2. Click the user row to open the detail sheet.
3. Click **Sitzungen widerrufen**.
4. Confirm the dialog.

This calls `POST /hub/admin/users/:id/revoke-sessions`, which proxies to
Better-Auth's admin session-revocation API. All in-flight requests with
that user's session token will receive 401 on the next auth check.

Alternatively, click the three-dot menu in the table row and choose
**Sitzungen widerrufen** — confirmation dialog still appears.

---

## Backend endpoints

All endpoints are mounted at `/hub/admin/users/` and require
`@Can("manage", "User")`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/hub/admin/users/list.json` | Paginated / filtered user list |
| `GET` | `/hub/admin/users/:id.json` | Full user detail (sessions + accounts) |
| `POST` | `/hub/admin/users/:id/ban` | Ban user (disables login) |
| `POST` | `/hub/admin/users/:id/unban` | Unban user |
| `POST` | `/hub/admin/users/:id/revoke-sessions` | Revoke all active sessions |

The ban / unban / revoke-sessions operations delegate to Better-Auth's
admin plugin so they stay in sync with the BA session store — no manual
Prisma writes needed.

---

## Security notes

- The `/hub/admin/` prefix is 404 outside `NODE_ENV=development`.
- Write actions require `@Can("manage", "User")` — by default only the
  `system-admin` role grants this.
- Banning a user does not delete their data — it sets `banned = true` on
  the Better-Auth user record, causing future sign-in attempts to fail
  immediately. Their historical data and audit entries are preserved.
