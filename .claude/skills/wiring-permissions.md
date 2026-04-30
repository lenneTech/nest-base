# Wiring Permissions

How permissions flow through the request, from authenticated user to
gated handler to filtered response. Reference for when you're adding
or debugging an `@Can()` decorator.

## The model (PLAN.md §6)

Three persisted concepts in Postgres:

| Entity         | Purpose                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Role**       | Named bundle of policies (`admin`, `editor`, `viewer`, ...)                                                         |
| **Policy**     | A reusable group of permissions (`projects:reader`, `billing:full`)                                                 |
| **Permission** | One row per `(role/policy → resource → action)` tuple, with optional `itemFilter` (Directus DSL) and `fields` array |

A user gets policies through their roles. The
`PermissionService.abilityFor(userId, tenantId)` resolves all policies
into a CASL ability — cached per (userId, tenantId) with a 60s TTL.

## The four layers a request passes through

```
Request
  ↓ AuthInterceptor    → req.user { id, tenantId, ...claims }
  ↓ PermissionInterceptor → req.ability (CASL PureAbility)
  ↓ CanGuard            → checks @Can() metadata vs req.ability
  ↓ Controller handler  → runs service logic
  ↓ OutputPipeline (4 stages):
      1. Record filter  (caller-side; the accessibleBy() filter ran at the DB)
      2. Field allowlist (drop fields the ability doesn't permit for `read`)
      3. Strip secrets   (passwords, tokens, secrets — fixed list)
      4. Safety net     (regex match on suspicious value shapes; throw|mask)
  ↓ Response
```

## Adding `@Can()` to a handler

```typescript
import { Can } from '../../core/permissions/can.guard.js';

@Post()
@Can('create', 'Project')
async create(@Body() dto: CreateProjectDto, @Req() req: AuthedRequest) {
  // CanGuard already ran. If we got here, the user has `create` on Project.
  return this.service.create(dto, req.user);
}
```

The `subject` string MUST match the Prisma model name capitalised
(e.g. `Project`, not `project` or `projects`). CASL keys conditions
(`{ tenantId, ownerId }`) off the same capitalised name.

The `action` is one of `create`, `read`, `update`, `delete`, `manage`
— or any custom verb you've registered in the permissions table.

## Read methods + record-level filtering

For list/get endpoints, skip `@Can('read', 'X')` if the
output-pipeline's record-level filter is enough:

```typescript
@Get()
async list(@Req() req: AuthedRequest) {
  // No @Can() — the Output-Pipeline filters records the ability denies.
  return this.service.list(req.user.tenantId);
}
```

For mutating endpoints, the gate **must** fire before the service runs
— don't lean on the pipeline to deny a write retroactively.

## The CASL conditions wire to record fields

When you persist a permission like:

```json
{
  "action": "read",
  "subject": "Project",
  "conditions": { "ownerId": "$CURRENT_USER" },
  "fields": ["id", "name", "status"]
}
```

The DB-rule resolver substitutes `$CURRENT_USER` for the requester's
id at ability-build time, producing a CASL rule:

```typescript
{ action: 'read', subject: 'Project', conditions: { ownerId: 'u-123' }, fields: ['id', 'name', 'status'] }
```

Then:

- `ability.can('read', { __caslSubjectType__: 'Project', ownerId: 'u-123', tenantId: 't-1' })` → true
- `ability.can('read', { __caslSubjectType__: 'Project', ownerId: 'u-other' })` → false
- The Output-Pipeline drops fields not in the allowlist (`description`,
  `notes`, etc.)

## Testing permission rules

Story-level — assert the metadata + ability builder behaviour:

```typescript
import { buildAbility } from "../../src/core/permissions/casl-ability.js";
import { Can, CAN_METADATA_KEY } from "../../src/core/permissions/can.guard.js";

it('the controller has @Can("create", "Project") on POST /', () => {
  class C {
    @Can("create", "Project") create() {}
  }
  const meta = Reflect.getMetadata(CAN_METADATA_KEY, C.prototype.create);
  expect(meta).toEqual({ action: "create", subject: "Project" });
});

it("a viewer ability rejects create", () => {
  const ability = buildAbility([{ action: "read", subject: "Project" }]);
  expect(ability.can("create", "Project")).toBe(false);
});
```

E2E-level — run the request with a fixture user that has the right /
wrong policies:

```typescript
const res = await request(app)
  .post("/projects")
  .set("Authorization", `Bearer ${viewerToken}`)
  .send({ name: "x" });
expect(res.status).toBe(403);
```

## Probing live permissions

The `/admin/permissions/test` endpoint (Permission-Tester UI) reads
the resolved ability for any user/tenant pair and renders it as a
table. Use it when debugging "why is User X blocked from Y?" without
mucking around in the database.

The underlying service is `PermissionTestService.getEffectivePermissions(userId, tenantId)` — it returns a typed `PermissionReport` shape you can also call from
admin tooling.

## Common gotchas

- **Subject case**: `'project'` ≠ `'Project'`. Capitalised, singular.
- **Manage as a superset**: a rule with `action: 'manage'` covers
  every CRUD verb. The PermissionTestService also promotes
  full-CRUD-coverage to `isSuperset` for the report.
- **`fields=[]` semantics**: currently treated as "no field-level
  restriction" (laxer than PLAN.md §6.3 strict reading). See
  `OPEN_QUESTIONS.md`.
- **Cache eviction**: `PermissionService` has a 60s TTL. After
  changing roles/policies, expect up to 60s of staleness or call
  `permissions.invalidate(userId, tenantId)` explicitly.
- **CASL rejects empty `fields`**: when registering rules, the ability
  builder strips `fields: []` before passing to CASL. Don't pass
  `fields: []` and expect "deny all fields" — that's the open
  question above.

## Don't reinvent

- **Want item-level filtering (only own records)?** Add a Permission
  with `itemFilter: { ownerId: { _eq: '$CURRENT_USER' } }`. The
  resolver does the substitution; CASL checks per-record.
- **Want field-level redaction?** Set the `fields` array on the
  Permission. The Output-Pipeline Stage 2 enforces.
- **Want admin-only routes?** A Role called `Admin` with a Policy that
  has `manage` on every relevant subject. The Permission-Tester will
  show the `isSuperset: true` badge.
