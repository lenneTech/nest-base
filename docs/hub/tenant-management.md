# Tenant Management UI

**Route:** `/hub/admin/tenants`  
**Issue:** #87  
**Backend path:** `src/core/dx/tenant-admin.controller.ts`  
**Frontend path:** `src/core/dx/clients/pages/TenantsAdminPage.tsx`

---

## Overview

The Tenant Management page lets operators list, create, soft-delete,
restore, and configure tenants (Better-Auth **Organizations**) — and
manage their members and invitations.

Backed by Better-Auth's `organization` and `member` tables (issue #118).
The custom `Tenant` / `TenantMember` Prisma models were replaced by BA
Organizations; tenant context is now resolved from
`session.activeOrganizationId` rather than a `User.tenantId` column.

All write actions are gated by `@Can("manage", "TenantAdmin")`.

---

## Tenant list

### Toolbar

| Control | Behaviour |
|---------|-----------|
| **Search input** | Debounced (300 ms) — filters by name or slug via `?q=<term>` |
| **Alle / Aktiv / Archiviert** | Toggle filter buttons; appends `?filter=active` or `?filter=deleted` |
| **+ Neu** | Opens the **Create Tenant** dialog |

Data is fetched from:

```
GET /hub/admin/tenants/list.json?q=<term>&filter=<all|active|deleted>
```

Returns `{ tenants: TenantListEntry[], total: number }`.

### Table columns

| Column | Notes |
|--------|-------|
| **Name** | Organization name |
| **Slug** | URL-safe identifier (monospace) or `—` |
| **Status** | `Aktiv` (default badge) / `Archiviert` (destructive badge) |
| **Mitglieder** | current member count |
| **Erstellt** | formatted date (de-DE locale) |

Clicking any row opens the **Tenant detail sheet**.

---

## Create tenant dialog

Fields:

| Field | Required | Notes |
|-------|----------|-------|
| **Name** | Yes | Organization display name (e.g. `Acme Corp`) |
| **Slug** | No | auto-derivable from name; used in URLs |
| **Kontakt-E-Mail** | No | primary contact address for the organization |

On submit: `POST /hub/admin/tenants` — creates a BA Organization and the
initial owner membership. The list refreshes automatically.

---

## Tenant detail sheet

Clicking a row slides in a right-side sheet panel (520–600 px wide).
Full tenant data is fetched from:

```
GET /hub/admin/tenants/:id.json
```

### Action buttons

| Button | Shown when | Endpoint |
|--------|-----------|----------|
| **Archivieren** (destructive) | tenant is active | `DELETE /hub/admin/tenants/:id/soft-delete` |
| **Wiederherstellen** (outline) | tenant is archived | `POST /hub/admin/tenants/:id/restore` |
| **Mitglied einladen** (outline) | always | opens the Invite Member dialog |

Soft-delete and restore both require a confirmation dialog before the
mutation fires.

### Tabs

**Übersicht** — a definition list with core tenant fields:

| Field | Notes |
|-------|-------|
| ID | UUID (monospace, wraps) |
| Name | display name |
| Slug | monospace or `—` |
| Status | `Aktiv` / `Archiviert` badge |
| Mitglieder | count |
| Erstellt | formatted date |

If there are pending invitations they are shown in a sub-table below
the definition list:

| Column | Notes |
|--------|-------|
| E-Mail | invited address |
| Rolle | invited role or `—` |
| Status | `pending` / other — badge |
| Läuft ab | invitation expiry date |

**Mitglieder** — a table of all current members:

| Column | Notes |
|--------|-------|
| E-Mail | `userEmail` or raw `userId` if not resolved |
| Rolle | `owner` (default badge) or `member` / other (secondary badge) |
| Seit | membership creation date |

**Einstellungen** — a definition list of per-tenant configuration:

| Setting | Notes |
|---------|-------|
| Logo-URL | logo image URL or `—` |
| Primärfarbe | hex colour swatch + value, or `—` |
| Speicherlimit (MB) | storage quota or `—` |
| Kontakt-E-Mail | contact address or `—` |

Shows an empty state if no settings have been saved.

**Statistiken** — a summary of tenant metrics:

| Metric | Notes |
|--------|-------|
| Mitglieder | member count (from BA `member` table) |
| Benutzer | total user count (may differ from member count) |
| Speicherverbrauch | storage used in MB (two decimal places) |
| Archiviert | `Ja` (destructive) / `Nein` badge |
| Erstellt | tenant creation date |

---

## Invite member dialog

Opens from the **Mitglied einladen** button in the detail sheet or from
the actions area.

Fields:

| Field | Required | Notes |
|-------|----------|-------|
| **E-Mail** | Yes | recipient address |
| **Rolle** | No | role to assign (`member` default; other values depend on project config) |

On submit: `POST /hub/admin/tenants/:id/members/invite` — sends a BA
invitation email. The invitation appears in the **Übersicht** tab's
pending invitations sub-table until accepted or expired.

---

## Soft-delete and restore

**Soft-delete** (`DELETE /hub/admin/tenants/:id/soft-delete`):

- Sets `softDeleted = true` on the BA Organization record.
- The tenant is hidden from active lists by default; still visible under
  the **Archiviert** filter.
- Members retain their membership records; they simply cannot resolve the
  tenant as their active organization.
- No data is permanently lost.

**Restore** (`POST /hub/admin/tenants/:id/restore`):

- Clears `softDeleted = true`, making the tenant active again.
- Member records are unchanged — the tenant becomes accessible immediately.

---

## Backend endpoints

All endpoints are mounted at `/hub/admin/tenants/` and require
`@Can("manage", "TenantAdmin")`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/hub/admin/tenants/list.json` | Filtered list (name/slug search + active/deleted filter) |
| `GET` | `/hub/admin/tenants/:id.json` | Full tenant detail (members + invitations + settings + stats) |
| `POST` | `/hub/admin/tenants` | Create a new BA Organization |
| `DELETE` | `/hub/admin/tenants/:id/soft-delete` | Soft-delete (archive) a tenant |
| `POST` | `/hub/admin/tenants/:id/restore` | Restore an archived tenant |
| `POST` | `/hub/admin/tenants/:id/members/invite` | Invite a new member by email |

---

## Underlying data model (BA Organizations)

As of issue #118, tenants are stored in Better-Auth's Organization tables:

| BA table | Purpose |
|----------|---------|
| `organization` | Core tenant record (name, slug, logo, metadata) |
| `member` | User ↔ Organization membership with role |
| `invitation` | Pending invitations with expiry and status |

Tenant context resolution: `session.activeOrganizationId` replaces the
former `User.tenantId` column. Operators activate an org via
`POST /api/auth/organization/set-active` (wired in the Hub SPA via
`bootstrapHubOperatorSession`). The `TenantInterceptor` reads the
session field and populates AsyncLocalStorage; `PrismaService.runWithRlsTenant()`
sets the Postgres GUC `app.tenant_id` for RLS. The `x-tenant-id` header
is not read on admin routes.

---

## Security notes

- `/hub/admin/` prefix is 404 outside `NODE_ENV=development`.
- `@Can("manage", "TenantAdmin")` — only `system-admin` role grants this
  by default.
- Soft-delete is non-destructive; a hard delete requires direct DB access
  and is intentionally not exposed via the UI.
