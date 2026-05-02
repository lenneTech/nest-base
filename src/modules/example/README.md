# Example module

Reference implementation of a tenant-scoped CRUD resource — the
**blank-slate** pattern (start a new resource from scratch). Compare
with `src/modules/user-profile/` which is the **extend-existing**
pattern.

## File layout — slim default, 5 files

```
src/modules/example/
├── README.md               ← this file
├── example.module.ts       ← @Module wiring (10 lines)
├── example.controller.ts   ← REST endpoints + tenant helper
├── example.service.ts      ← business logic + Prisma calls + types + errors
└── example.dto.ts          ← Zod schemas + inferred types
```

That's the slim default for ~95 % of modules. Service uses
`PrismaService` directly via the typed Prisma client. No repository
abstraction, no DI token, no in-memory variant in production code.
Tests run against a small `FakePrismaService` from
`tests/lib/fake-prisma.ts`.

If you genuinely need mock-swappable storage (multiple backends,
non-Prisma persistence, paranoid security-test isolation): bring
back the `<x>.repository.ts` interface + Prisma + in-memory split.
The pattern is documented in
`.claude/skills/adding-feature-module.md`. Default is slim.

## Endpoints

| Method   | Path            | Behaviour                                                |
| -------- | --------------- | -------------------------------------------------------- |
| `POST`   | `/examples`     | Create record. 201 on success.                           |
| `GET`    | `/examples`     | List records (cursor-paginated, optional status filter). |
| `GET`    | `/examples/:id` | Fetch one. 404 when missing or foreign-tenant.           |
| `PATCH`  | `/examples/:id` | Patch fields.                                            |
| `DELETE` | `/examples/:id` | Remove. 204 on success.                                  |

Every handler carries `@Can('action', 'Example')` so `/dev/routes`
shows the module guarded.

## Patterns demonstrated

### 1. Tenant scoping via RLS

Every Postgres call goes through
`prisma.runWithRlsTenant(callback, tenantId)`. That opens a
transaction, runs `SET LOCAL app.tenant_id = '<uuid>'`, and runs the
callback inside. The RLS policy on the `examples` table refuses
foreign-tenant rows automatically — even a forgotten `WHERE` clause
can't leak across tenants.

### 2. Typed Prisma client

The service uses `tx.example.create({data})`,
`tx.example.findMany({where, orderBy})`, etc. — typed methods, not
raw SQL. After `bun run prisma:generate` the types come from the
generated client.

### 3. Cursor pagination

`buildCursorPage()` from `src/core/pagination/cursor.js` slices the
filtered set. The repository (the in-line Prisma call) returns the
full filtered list ordered by `createdAt DESC`; the service trims to
the requested page.

### 4. Named error sentinels

`ExampleNotFoundError` lives at the top of `example.service.ts` and
extends `ResourceNotFoundError` (from `src/core/errors/`). The base
class is a thin wrapper over NestJS' `NotFoundException`, so the
global `ProblemDetailsFilter` maps it to RFC 7807 with a 404 status
and `code: CORE_NOT_FOUND` automatically. The controller never has
to know about the error class.

> **Don't** roll your own `class FooNotFoundError extends Error`.
> Plain-`Error` subclasses fall through the filter to a 500 +
> `CORE_INTERNAL` because the filter only recognises
> `HttpException`, `ZodError`, and a small set of framework
> sentinels. Always extend `ResourceNotFoundError` (or the matching
> NestJS exception, e.g. `ConflictException`, `BadRequestException`).

### 5. Zod-driven DTOs

`example.dto.ts` defines four schemas (Create, Update, ListQuery,
Response). Each schema is the single source of truth — TypeScript
types are inferred (`z.infer<...>`), runtime validation goes through
`ZodValidationPipe`, Swagger schemas come from the same shape.

## Schema + migration

The `Example` model lives in `prisma/schema.prisma`; the migration
lives at
`prisma/migrations/20260430000000_example_module/migration.sql`. The
migration creates the `examples` table, indexes `tenant_id`, enables
RLS, and installs the `tenant_isolation` policy. After
`bun run prisma:migrate` (or `bun run reset`) the routes work
end-to-end against real Postgres.

## Tests

`tests/stories/example-module.story.test.ts` exercises the service
against `createFakePrisma()` from `tests/lib/fake-prisma.ts`. Fast
(no DB), realistic enough (every method the service uses is
mirrored). When you copy this module:

```typescript
import { createFakePrisma, asPrismaService } from "../lib/fake-prisma.js";
const prisma = createFakePrisma();
const service = new ExampleService(asPrismaService(prisma));
```

For full HTTP-round-trip tests (with `@Can()`, output pipeline, RLS),
write `tests/<resource>.e2e-spec.ts` against a real testcontainer
Postgres — that's what `tests/global-setup.ts` already provides.

When you copy this module: rename `Example`/`example`, adjust the DTO
fields, update the migration, write story tests RED first, six gates
green, commit.
