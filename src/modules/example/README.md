# Example module

Reference implementation of a tenant-scoped CRUD resource. Copy this
folder when you start a new module — the structure below is what the
project considers a clean, well-separated NestJS module.

## File layout — one responsibility per file

```
src/modules/example/
├── README.md                       ← this file
├── example.module.ts               ← @Module wiring (controller + service + repo binding)
├── example.controller.ts           ← REST endpoints — thin transport layer
├── example.service.ts              ← business logic only (id, timestamps, pagination, errors)
├── example.repository.ts           ← repository contract (interface)
├── example.repository.prisma.ts    ← Prisma-backed implementation (production default)
├── example.repository.in-memory.ts ← in-memory implementation (tests / cold-boot dev)
├── example.dto.ts                  ← Zod request + response schemas
├── example.types.ts                ← internal record + status types
├── example.errors.ts               ← named error sentinels (ExampleNotFoundError)
├── example.tokens.ts               ← DI tokens (EXAMPLE_REPOSITORY symbol)
├── example.mapper.ts               ← record → response shape
└── require-tenant.ts               ← tenant-id retrieval helper from AsyncLocalStorage
```

Every file is small (most under 50 lines) and named for what it owns.
A new contributor opening any single file knows what's in it without
having to scroll.

## Layer responsibilities

```
HTTP request
   │
   ▼
ExampleController          ← validates DTO, picks tenant, delegates
   │
   ▼  (interface call)
ExampleService             ← business logic: ids, timestamps, pagination, errors
   │
   ▼  (interface call)
ExampleRepository          ← persistence contract
   │
   ├─► PrismaExampleRepository    (real Postgres + RLS)
   └─► InMemoryExampleRepository  (tests + dev fallback)
```

The service depends on the `ExampleRepository` _interface_, never on a
specific implementation. Swapping production from in-memory to Prisma
is a one-line change in `example.module.ts`.

## Patterns demonstrated

### 1. Tenant scoping via RLS

Every Postgres call in `PrismaExampleRepository` goes through
`prisma.runWithRlsTenant(callback, tenantId)`. That opens a
transaction, runs `SET LOCAL app.tenant_id = '<uuid>'`, and executes
the callback inside. The RLS policy on the `examples` table refuses
rows from other tenants automatically — even if a `WHERE` clause is
forgotten, the database enforces the boundary.

### 2. Repository interface (not BaseRepository inheritance)

`ExampleRepository` is a small interface, not an abstract base class.
Two implementations satisfy it side-by-side. The service can mock the
repo with three lines of code in tests:

```typescript
const fake: ExampleRepository = {
  insert: vi.fn(),
  findById: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const service = new ExampleService(fake);
```

### 3. Named error sentinels

`ExampleNotFoundError` is thrown by the service. The global
`ProblemDetailsFilter` maps it to RFC 7807 with the right status code.
The HTTP layer never has to know about specific error classes.

### 4. Zod-driven DTOs

`example.dto.ts` defines four schemas: `CreateExample`, `UpdateExample`,
`ListExampleQuery`, `ExampleResponse`. Each schema is the single
source of truth — TypeScript types are inferred (`z.infer<...>`),
runtime validation goes through `ZodValidationPipe`, and Swagger
schemas are generated from the same shape.

### 5. Cursor pagination

`buildCursorPage()` from `src/core/pagination/cursor.js` handles the
slicing. The repository returns the full filtered set; the service
sorts and asks the helper for "give me page N starting after cursor X".

### 6. Permission gates

Every handler carries `@Can("action", "Example")`. The
`PermissionInterceptor` resolves the active CASL ability per request,
the `CanGuard` reads it. Auditors check `/dev/routes` to see every
endpoint's guard at a glance.

## Schema + migration shipped with this module

Out of the box the module wires `PrismaExampleRepository` and ships
the matching `Example` model in `prisma/schema.prisma` plus a
migration at
`prisma/migrations/20260430000000_example_module/migration.sql`. The
migration creates the `examples` table, indexes `tenant_id`, enables
RLS, and installs the tenant-isolation policy. After
`bun run prisma:migrate` (or `bun run reset`), `POST /examples`
works end-to-end against real Postgres.

Story tests run against the in-memory repository — no DB needed.

## Swapping to the in-memory repository

Useful if you want the module to boot before migrations are applied
or you're in a CI lane without Postgres. One line in
`example.module.ts`:

```typescript
// Default — real DB, real RLS:
{ provide: EXAMPLE_REPOSITORY, useClass: PrismaExampleRepository },

// In-memory — process-local, no DB:
{ provide: EXAMPLE_REPOSITORY, useClass: InMemoryExampleRepository },
```

The service stays unchanged; the DI token is what makes the swap
trivial.

## Tests

| Where                                             | What it covers                                                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/stories/example-module.story.test.ts`      | Service behaviour against the in-memory repo: tenant isolation, list filter, cursor pagination, not-found, update / delete cross-tenant rejection. |
| `tests/<resource>.e2e-spec.ts` (when you add one) | Full HTTP round-trip including @Can() guard, permissions interceptor, RLS.                                                                         |

When you copy this module: rename `Example`/`example` everywhere,
adjust the DTO schemas to your domain, write the Prisma migration with
the RLS policy, write your story tests RED first, then implementation,
then six gates.
