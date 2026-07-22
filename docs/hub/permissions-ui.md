# Permissions Admin UI

**Route:** `/hub/admin/permissions` (matrix + CRUD)  
**Tester route:** `/hub/admin/permissions/test`  
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

1. **`/hub/admin/permissions`** — edit the Berechtigungsmatrix (checkboxes per
   role × resource × action).
2. **`/hub/admin/permissions/test`** — resolve the effective CASL ability
   for a given `(userId, tenantId)` pair so operators can diagnose 403s.

Both pages are gated by `@Can("manage", "PermissionsAdmin")` on the
controller side. The `/hub/admin/` prefix is also in the allowlist that
restricts access to `NODE_ENV=development`.

---

## Permission matrix — `/hub/admin/permissions`

Single-page **Berechtigungsmatrix** (no separate list or manual create form).

Data from:

```
GET /hub/admin/permissions/matrix.json
```

with Better-Auth session cookies and an active organization from
`POST /api/auth/organization/set-active` (via `bootstrapHubOperatorSession` on
page load). The **Tenant-UUID** field appears only when bootstrap could not
resolve a default org.

**Matrix structure:**

- **Rows** = canonical CASL subjects from `buildAbilitySubjectCatalogFromRepo()`
  (route-gating audit `@Can` subjects + member defaults + framework admin
  subjects), merged with any resource that already has permission rows.
  The wildcard subject `all` is excluded from the grid.
- **Columns** = each role in the tenant (`roleIds`), with a sub-header per
  action: C/R/U/D/S (`CREATE`, `READ`, `UPDATE`, `DELETE`, `SHARE`).
- **Cells** = checkboxes. Checked when the role’s attached policies grant
  that action on the resource (`MANAGE` checks all five).
- **Toggle grant** — `POST /hub/admin/permissions` on the role’s primary policy
  (first `role_policies` link; auto-creates `Matrix — {role}` policy +
  attach when missing).
- **Toggle revoke** — `DELETE /hub/admin/permissions/:id` using `grants` metadata
  in the matrix payload; revoking one action under a `MANAGE` row splits
  into explicit per-action permissions for the remaining actions.

Optional **Ressource filtern** narrows rows client-side. Role names come from
`GET /hub/admin/roles`.

---

## Permission tester — `/hub/admin/permissions/test`

### Lookup form

A GET form with two inputs:

| Input | URL parameter |
|-------|---------------|
| **User ID** | `?userId=<uuid>` |
| **Tenant ID** | `?tenantId=<uuid>` |

On submit the URL is updated and the React `useLocation` → `useQuery`
chain fires:

```
GET /hub/admin/permissions/test.json?userId=<uuid>&tenantId=<uuid>
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
