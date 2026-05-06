# Permissions Admin UI

**Route:** `/admin/permissions` (matrix + CRUD)  
**Tester route:** `/admin/permissions/test`  
**Issue:** #84  
**Backend paths:**
- `src/core/permissions/permissions-admin.controller.ts`
- `src/core/permissions/permission-tester.controller.ts`

**Frontend paths:**
- `src/core/dx/clients/pages/PermissionsAdminPage.tsx`
- `src/core/dx/clients/pages/PermissionTesterPage.tsx`

---

## Overview

The Permissions admin UI has two linked pages:

1. **`/admin/permissions`** — view the full permission matrix and create /
   delete `Permission` records (raw CASL rules stored in Postgres).
2. **`/admin/permissions/test`** — resolve the effective CASL ability
   for a given `(userId, tenantId)` pair so operators can diagnose 403s.

Both pages are gated by `@Can("manage", "PermissionsAdmin")` on the
controller side. The `/admin/` prefix is also in the allowlist that
restricts access to `NODE_ENV=development`.

---

## Permission matrix — `/admin/permissions`

### Matrix card (collapsible)

The top card shows a `resource × role` table fetched from:

```
GET /api/admin/permissions/matrix.json
```

with the `x-tenant-id` request header set to the UUID the operator enters
in the **Tenant-UUID** input.

**Matrix structure:**

| | Role A | Role B | … |
|---|---|---|---|
| Resource X | READ, UPDATE | — | … |
| Resource Y | CREATE, READ | SHARE | … |

- Rows = every distinct resource string found in the `permissions` table
- Columns = every `roleId` that has at least one permission
- Cell = comma-separated list of actions (`CREATE`, `READ`, `UPDATE`,
  `DELETE`, `SHARE`) or `—` if the role has no grant for that resource
- Role names are resolved from `GET /api/admin/roles` via a `roleId → name`
  map; truncated UUID is shown as fallback

The card is expanded by default; clicking **Einklappen** collapses it to
save vertical space.

### Create permission form

A five-field inline form below the matrix:

| Field | Type | Notes |
|-------|------|-------|
| **Policy-ID** | text | UUID of the CASL policy this permission attaches to |
| **Resource** | text | CASL subject string (e.g. `Project`, `File`) |
| **Action** | select | `CREATE`, `READ`, `UPDATE`, `DELETE`, `SHARE` |
| **Fields (CSV)** | text | Comma-separated field names; empty = all fields |
| Submit | button | Disabled when Policy-ID or Resource is empty |

`POST /api/admin/permissions` creates the record. On success, the
permission list below refreshes and a toast confirms the action.

### Permission list table

A table of all `Permission` rows from `GET /api/admin/permissions`.
Columns: truncated ID, truncated Policy-ID, Resource, Action, Fields.
Each row has a **Löschen** button that calls `DELETE /api/admin/permissions/:id`
after a `window.confirm()` guard.

---

## Permission tester — `/admin/permissions/test`

### Lookup form

A GET form with two inputs:

| Input | URL parameter |
|-------|---------------|
| **User ID** | `?userId=<uuid>` |
| **Tenant ID** | `?tenantId=<uuid>` |

On submit the URL is updated and the React `useLocation` → `useQuery`
chain fires:

```
GET /api/admin/permissions/test.json?userId=<uuid>&tenantId=<uuid>
```

The URL-driven approach means the back button replays prior lookups.

### Effective abilities report

A table of every resource the user can act on, grouped by CASL subject:

| Column | Notes |
|--------|-------|
| **Resource** | CASL subject string (monospace) |
| **Actions** | comma-separated list |
| **superset badge** | shown when the resolved ability is a wildcard superset (`manage all`) |

An empty state is shown when the user has no permissions in the given
tenant context.

---

## How this maps to the backend

`Permission` rows are Prisma-backed records in the `permissions` table:

```prisma
model Permission {
  id       String   @id @default(uuid()) @db.Uuid
  policyId String   @map("policy_id") @db.Uuid
  resource String
  action   String   // 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'SHARE'
  fields   String[]
}
```

`PermissionService.buildAbility(userId, tenantId)` loads all `Permission`
rows that belong to the policies attached to the user's roles in the given
tenant, then constructs a CASL `PureAbility` from them. This ability object
is what `CanGuard`, `@Can()`, `accessibleBy()`, and the output-pipeline
field-allowlist all consume.

`fields = []` means "no field restriction" (same semantics as null). See
`OPEN_QUESTIONS.md` for the rationale — CASL cannot represent
"deny every field" in a single rule.

---

## Adding a permission to a role

Via the create form or a seed script:

```typescript
await prisma.permission.create({
  data: {
    policyId: adminPolicyId,   // the policy attached to the 'admin' role
    resource: 'Invoice',
    action: 'READ',
    fields: [],                // all fields
  },
});
```

The permission tester immediately reflects the change — no restart needed.
