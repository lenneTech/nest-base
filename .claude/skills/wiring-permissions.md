# Wiring Permissions

How permissions flow through the request, from authenticated user to
gated handler to filtered response. Reference for when you're adding
or debugging an `@Can()` decorator.

## Decision flow — gate, public, or allowlist?

Before writing the route body, decide which the handler is. The
project rule (see "Route gating policy" in
[`CLAUDE.md`](../../CLAUDE.md)) is: every controller method is exactly
one of these three. A handler that is none of them is a bug — Issue
#47 will add a CI check that fails on this.

```
new route?
  ├── touches user/tenant data, mutates state, or reads anything
  │   permission-shaped
  │     → @Can(action, subject)        ← default. pick existing subject.
  ├── intentionally callable without auth (health, OAS, error
  │   catalogue, anonymous webhook with own HMAC verification)
  │     → @Public("<one-sentence reason>")
  └── part of a subsystem-wide pattern (`/health/*`, `/api/auth/*`,
      `/dev/*`, `/me/*`) where every route in the subtree is public
        → path-allowlist in `src/core/auth/jwt-middleware.ts`
          (`PUBLIC_PREFIXES` / `PUBLIC_EXACT`) and/or
          `src/core/multi-tenancy/tenant-guard.ts` (`EXEMPT_*`)
```

If you cannot decide between `@Can()` and `@Public()`: stop, default
to `@Can()`. Never delete an `@Can()` "to fix a 403" — fix the policy
or storage adapter instead.

### When `@Public()` is appropriate

A short checklist. If your route is none of these, it probably wants
`@Can()`:

- Health / readiness probes consumed by an orchestrator
- OAS / SDK-discovery catalogues meant to be fetched anonymously
  (e.g. `/errors`, the public OpenAPI doc)
- Anonymous webhooks that bring their own HMAC / signature verification
  (the gate is the signature, not CASL)
- Marketing / docs landing pages served from the same NestJS app

`@Public()` requires a non-empty reason string — write *why*, not
*what*:

```typescript
import { Public } from "../../core/permissions/public.decorator.js";

@Get("/health")
@Public("k8s readiness probe — must answer without auth")
health(): { ok: true } {
  return { ok: true };
}
```

### Migrating an existing ungated route

Two options when an audit (or `/dev/routes`) flags a handler as
`unguarded`:

```diff
 // Option A — gate it (default)
+import { Can } from "../../core/permissions/can.guard.js";

 @Get()
+@Can("read", "Project")
 list(@Req() req: AuthedRequest) {
   return this.service.list(req.user.tenantId);
 }
```

```diff
 // Option B — declare it intentionally public
+import { Public } from "../../core/permissions/public.decorator.js";

 @Get("/openapi")
+@Public("public OpenAPI catalogue consumed by SDK generators")
 openapi(): OpenAPIObject {
   return this.builder.build();
 }
```

Always commit both changes — the metadata-bearing decorator AND a
test that asserts the metadata is in place (see "Testing permission
rules" below). Don't lean on grep.

## The model

See [`docs/architecture.md`](../../docs/architecture.md) "Permission
model" for the full picture; condensed here:

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

Note: under the route-gating policy, "no `@Can()`" still requires
either `@Public()` or a path-allowlist match — the Output-Pipeline
filter is defence in depth, not a substitute for the consent token.

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

For `@Public()`-decorated handlers the equivalent assertion uses
`PUBLIC_ROUTE_METADATA_KEY` from `public.decorator.js`:

```typescript
import {
  PUBLIC_ROUTE_METADATA_KEY,
  isPublicRoute,
} from "../../src/core/permissions/public.decorator.js";

it("GET /health is explicitly public with a reason", () => {
  const meta = Reflect.getMetadata(PUBLIC_ROUTE_METADATA_KEY, HealthController.prototype.health);
  expect(isPublicRoute(meta)).toBe(true);
  expect(meta.reason).toMatch(/probe/);
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
- **`fields=[]` semantics**: treated as "no field-level restriction".
  See `OPEN_QUESTIONS.md` (CASL cannot represent "deny every field" in a
  single rule).
- **Cache eviction**: `PermissionService` has a 60s TTL. After
  changing roles/policies, expect up to 60s of staleness or call
  `permissions.invalidate(userId, tenantId)` explicitly.
- **CASL rejects empty `fields`**: when registering rules, the ability
  builder strips `fields: []` before passing to CASL. Don't pass
  `fields: []` and expect "deny all fields" — that's the open
  question above.
- **`@Public("")` is a bug**: the decorator throws at decoration time
  if the reason is empty / whitespace. Write the *why*, not the *what*.

## Don't reinvent

- **Want item-level filtering (only own records)?** Add a Permission
  with `itemFilter: { ownerId: { _eq: '$CURRENT_USER' } }`. The
  resolver does the substitution; CASL checks per-record.
- **Want field-level redaction?** Set the `fields` array on the
  Permission. The Output-Pipeline Stage 2 enforces.
- **Want admin-only routes?** A Role called `Admin` with a Policy that
  has `manage` on every relevant subject. The Permission-Tester will
  show the `isSuperset: true` badge.
