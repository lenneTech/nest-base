# UserProfile module

Reference implementation for **extending an existing
framework-managed entity** with project-specific fields. Compare
with `src/modules/example/` (blank-slate pattern); this module
shows what to do when the entity itself (the User) is owned by the
core (Better-Auth handles its lifecycle).

## File layout — slim default, 5 files

```
src/modules/user-profile/
├── README.md                       ← this file
├── user-profile.module.ts          ← @Module wiring
├── user-profile.controller.ts      ← /me/profile GET + PATCH
├── user-profile.service.ts         ← business logic + Prisma + types + errors
└── user-profile.dto.ts             ← Zod schemas
```

Same structure as `example/` — service uses `PrismaService` directly,
no repository abstraction, tests use the `FakePrismaService` helper
from `tests/lib/fake-prisma.ts`. If you genuinely need
mock-swappable storage, bring back the repository layer; the slim
default fits 95 % of cases.

## Endpoints

| Method  | Path          | Behaviour                                                       |
| ------- | ------------- | --------------------------------------------------------------- |
| `GET`   | `/me/profile` | Returns the calling user's profile. Auto-creates on first call. |
| `PATCH` | `/me/profile` | Patches the profile. Lazy-creates if missing.                   |

Both routes are guarded by `@Can('read'|'update', 'UserProfile')`
and inherently scoped to the authenticated user via `req.user.id` —
no `:id` parameter, so a user can never ask for someone else's
profile.

## Patterns demonstrated (different from `example/`)

### 1. 1:1 extension via UNIQUE FK

```sql
user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
```

UNIQUE enforces the 1:1 invariant at the DB layer. ON DELETE CASCADE
means user-account deletion (Better-Auth or the GDPR `/me/account`
flow) auto-removes the profile — no orphan rows.

### 2. Denormalised tenant column

`tenant_id` lives on `user_profiles` even though it could be joined
from `users`. Why: RLS policies need the column on the same table to
fire without a JOIN. Trade-off is a write-time consistency rule
(service guarantees `profile.tenantId == user.tenantId`, easy
because both come from the same `req.user`).

### 3. Lazy-create on first read

`service.getOrCreate(tenantId, userId)` returns the existing profile
or creates an empty one and returns that. Two upsides:

- A freshly signed-up user sees `200 { displayName: null, ... }` on
  first GET, never a confusing 404.
- The frontend never has to choose between POST-then-PATCH and just
  PATCH; PATCH always works.

### 4. JSONB preferences bucket

`preferences` is a `JSONB` column for fields that don't deserve their
own column yet (theme, locale, notification toggles, dashboard
layout). When a key proves load-bearing, promote it to a real column
in a follow-up migration.

### 5. Current-user retrieval, not URL params

```typescript
@Get()
async getMine(@Req() req: AuthedRequest) {
  const { id, tenantId } = requireCurrentUser(req);
  return this.service.getOrCreate(tenantId, id);
}
```

The data scope IS the authenticated user. Pattern for any `/me/*`
route.

## Schema + migration

`prisma/schema.prisma` has the `UserProfile` model;
`prisma/migrations/20260430000100_user_profile_module/migration.sql`
creates the table + index + RLS policy. After `bun run prisma:migrate`
the routes work end-to-end.

## Tests

`tests/stories/user-profile-module.story.test.ts` runs against
`createFakePrisma()`. Same fast-test ergonomics as `example/`. When
you copy this module: rename the prefix, adjust DTO fields, update
the migration.
