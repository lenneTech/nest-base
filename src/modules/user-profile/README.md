# UserProfile module

Reference implementation for **extending an existing
framework-managed entity** with project-specific fields. The User
itself is owned by the core (Better-Auth manages its lifecycle —
sign-up, sign-in, session). When a project needs `displayName`,
`avatarUrl`, `bio`, `preferences`, or any other domain field on top
of the user, the right pattern is a separate `UserProfile` table
linked 1:1 via the unique `user_id` foreign key.

Compare with `src/modules/example/` — the `example` module is the
**blank-slate** reference (new resource from scratch); this module
is the **extend-existing** reference. Both use the same internal
structure (12-file layout) so a contributor can pattern-match
between them.

## File layout

```
src/modules/user-profile/
├── README.md                            ← this file
├── user-profile.module.ts               ← @Module wiring
├── user-profile.controller.ts           ← /me/profile GET + PATCH
├── user-profile.service.ts              ← lazy-create-on-first-read
├── user-profile.repository.ts           ← interface contract
├── user-profile.repository.prisma.ts    ← real Postgres + RLS (default)
├── user-profile.repository.in-memory.ts ← tests / fallback
├── user-profile.dto.ts                  ← Zod schemas
├── user-profile.types.ts                ← UserProfileRecord
├── user-profile.errors.ts               ← named sentinels
├── user-profile.tokens.ts               ← DI token
├── user-profile.mapper.ts               ← record → response
└── require-current-user.ts              ← `req.user.id` helper
```

## Endpoints

| Method  | Path          | Behaviour                                                                                                         |
| ------- | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/me/profile` | Returns the calling user's profile. Auto-creates an empty profile on first call so a fresh user never sees a 404. |
| `PATCH` | `/me/profile` | Patches the calling user's profile (idempotent: lazy-create if missing).                                          |

Both routes are guarded by `@Can('read'|'update', 'UserProfile')`
and inherently scoped to the authenticated user via
`req.user.id` — there's no `:id` parameter, so a user can never
ask for someone else's profile.

## Patterns demonstrated (different from `example/`)

### 1. 1:1 extension via UNIQUE FK

```sql
user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
```

The UNIQUE constraint enforces the 1:1 invariant at the DB layer.
ON DELETE CASCADE means user-account deletion (Better-Auth or the
GDPR `/me/account` flow) automatically removes the profile too — no
orphan rows.

### 2. Denormalised tenant column

The `tenant_id` lives on `user_profiles` as well as on `users`,
even though it could be joined. Why: RLS policies need
`current_setting('app.tenant_id')` to compare against a column on
the same table — without the denormalised column, every read
would have to JOIN users which kills RLS performance.

The trade-off: a write-time consistency rule. The service guarantees
`profile.tenant_id == user.tenant_id` because both come from the
same `req.user.tenantId` on every call.

### 3. Lazy-create on first read

`service.getOrCreate(tenantId, userId)` returns the existing profile
or creates an empty one and returns that. Two upsides:

- A freshly signed-up user sees `200 { displayName: null, ... }`
  on first GET, not a confusing 404.
- The frontend never has to decide between POST-then-PATCH and just
  PATCH; PATCH always works and creates if needed.

### 4. JSONB for flexible preferences

`preferences` is a `JSONB` bucket that holds whatever the project
hasn't promoted to its own column yet — theme, locale, notification
toggles, dashboard layout. When a key in there proves load-bearing,
promote it to a real column in a follow-up migration.

### 5. Current-user retrieval, not URL params

```typescript
@Get()
async getMine(@Req() req: AuthedRequest) {
  const { id, tenantId } = requireCurrentUser(req);
  return this.service.getOrCreate(tenantId, id);
}
```

Compared to `example/` where the controller takes the resource id
from `:id`, this controller takes nothing from the URL — the data
scope IS the authenticated user. That's the model for any `/me/*`
route.

## Schema + migration

`Example` and `UserProfile` are both in `prisma/schema.prisma` and
both ship migration files. After `bun run prisma:migrate` the routes
are fully functional against real Postgres.

If you don't want the `user_profiles` table in your project, drop
the model from `schema.prisma`, drop the migration directory, and
unwire `UserProfileModule` from `AppModule`.

## Tests

Story tests cover the service against the in-memory repo:
lazy-create on GET, idempotent re-read, patch semantics, preferences
JSON round-trip, tenant isolation, fresh user → empty defaults.

When you copy this module for `Project`, `Order`, or any other
"extend the user" use-case: rename the prefix, adjust the DTO
fields, and the patterns transfer 1:1.
