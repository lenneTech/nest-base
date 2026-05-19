# Adding a Feature Module

End-to-end flow for adding a project resource under `src/modules/`. The
`module-scaffolder` agent runs this whole sequence; use this skill when
you want to do it by hand or understand what the agent does.

## When to use this

- Adding a new domain entity (Project, Order, Invoice, ...)
- Carving out a new sub-API (e.g. `/widgets`, `/integrations`)
- Anything that's _project-specific_ and doesn't belong in `src/core/`

If the capability is generic enough to benefit every project on the
template → skip this skill, send a PR upstream via
`bun run sync:to-template`.

## Prerequisites (environment)

| Situation | Command |
| --- | --- |
| Fresh clone, no `.env` / DB | `bun install && bun run setup` |
| `.env` exists, need migrate/seed | `bun run setup --bootstrap` |
| Schema-only change in this session | `prepare:schema` → `prisma:generate` → `migrate dev` (below) |

`bun run setup` does **not** ask interactive feature questions — edit
`src/config/features.ts` or use `/hub/features`, then `prepare:schema`.

## Reference modules to copy from

Two reference implementations live in `src/modules/`. Pick the one
that matches your scenario, then copy + rename + adjust.

| Pattern                       | Reference                   | Use when                                                                               |
| ----------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| **Blank-slate CRUD**          | `src/modules/example/`      | New resource the project owns end-to-end (e.g. `Project`, `Order`).                    |
| **Extend an existing entity** | `src/modules/user-profile/` | Adding fields to something the core already manages (e.g. extending `User`, `Tenant`). |

Both follow the **slim 5-file default** described below. Read the
`README.md` inside each for the full set of patterns demonstrated.

## The shape — slim default (5 files)

```
src/modules/<resource>/
├── README.md                  ← what this module demonstrates (1-2 pages)
├── <resource>.module.ts       ← @Module() declaration
├── <resource>.controller.ts   ← REST endpoints + @Can() gates
├── <resource>.service.ts      ← business logic + Prisma calls + types + errors
└── <resource>.dto.ts          ← Zod schemas + inferred types

prisma/schema.prisma             ← model added here (always-on)
   OR
prisma/features/<feature>.prisma ← model here (feature-gated)

tests/stories/<resource>-module.story.test.ts  ← red-first, runs against FakePrisma
```

This fits ~95 % of modules. The service uses `PrismaService` directly
(no repository abstraction, no DI token, no in-memory variant in
production code). Tests run against the in-memory `FakePrismaService`
helper from `tests/lib/fake-prisma.ts`.

If you genuinely need mock-swappable storage (multiple backends,
non-Prisma persistence, paranoid security-test isolation) → see
[Layered pattern (opt-in)](#layered-pattern-opt-in) at the bottom.

## Step 0 — Schema first, then `prisma:generate` (CRITICAL)

Before you write a single line of service code that calls
`tx.<resource>.*`, the Prisma client has to know your new model.
Otherwise `tx.<resource>` is `undefined` at the type level and you'll
be tempted to write `(tx as any).<resource>.*` — which we don't do in
this repo.

```bash
# 1) Edit prisma/schema.prisma (or prisma/features/<feature>.prisma)
#    — add the model.

# 2) Concat + generate. Both steps are required:
bun run prepare:schema    # rewrites prisma/schema.generated.prisma
bun run prisma:generate   # rewrites node_modules/.prisma/client
```

After this, `import type { <Resource> } from '@prisma/client'` resolves
and `tx.<resource>.create(...)` is fully typed. **No casts.**

If you later see `Property '<resource>' does not exist on type
'TransactionClient'` or `Module '@prisma/client' has no exported member
'<Resource>'` — the generator is stale, regenerate. Don't reach for
`as any`.

## Step 1 — Story tests (RED first)

Path: `tests/stories/<resource>-module.story.test.ts`

> **Prerequisite:** before you write the story test, register the new
> resource on `FakePrismaService` (`tests/lib/fake-prisma.ts`). The
> fake is a hand-typed map of tables; without an entry your service
> code will hit `undefined.create()` at runtime. See **Step 1.5**
> below — do it before you let the story file import.

Use the in-memory fake — fast, no Postgres needed:

```typescript
import { beforeEach, describe, expect, it } from "vitest";

import { <Resource>Service } from "../../src/modules/<resource>/<resource>.service.js";
import { asPrismaService, createFakePrisma } from "../lib/fake-prisma.js";

const TENANT_A = "00000000-0000-7000-8000-00000000000a";
const TENANT_B = "00000000-0000-7000-8000-00000000000b";

function makeService(): <Resource>Service {
  return new <Resource>Service(asPrismaService(createFakePrisma()));
}

describe("Story · <Resource> module", () => {
  let service: <Resource>Service;
  beforeEach(() => { service = makeService(); });

  it("creates a record scoped to the tenant", async () => {
    const out = await service.create(TENANT_A, { name: "x" });
    expect(out.name).toBe("x");
  });

  it("isolates tenants in list", async () => {
    await service.create(TENANT_A, { name: "A" });
    await service.create(TENANT_B, { name: "B" });
    const page = await service.list(TENANT_A, { limit: 20 });
    expect(page.items.map((r) => r.name)).toEqual(["A"]);
  });

  // ... update, delete, not-found, DTO validation
});
```

Cover at minimum:

- `service.create()` happy path
- `service.list()` filtered by tenant — proves tenant isolation
- `service.findById()` not-found and wrong-tenant cases
- `service.update()` happy + not-found
- `service.remove()` happy + not-found
- DTO validation: malformed input rejected with the right Zod issue

Verify red:

```bash
bun run test:e2e tests/stories/<resource>-module.story.test.ts
```

Commit:

```bash
git add -A && git commit -m "test(<resource>): add red tests for module skeleton"
```

## Step 1.5 — Extend `FakePrisma` with the new table

`tests/lib/fake-prisma.ts` is a hand-typed in-memory stand-in for
`PrismaService` used by every slim-module story test. It is **not**
auto-derived from `schema.prisma` — adding a new resource means
appending a single table entry by hand, in three places.

Edit `tests/lib/fake-prisma.ts`:

```typescript
// 1. Field on the FakePrismaService interface (~ line 136):
export interface FakePrismaService {
  example: TableMock<Row>;
  userProfile: TableMock<Row>;
  <resource>: TableMock<Row>;          // ← add
  runWithRlsTenant<T>(fn: (tx: FakePrismaService) => Promise<T>, tenantId?: string): Promise<T>;
  __resetAll(): void;
}

// 2. Table instance + assembly inside createFakePrisma():
export function createFakePrisma(): FakePrismaService {
  const example = makeTable();
  const userProfile = makeTable();
  const <resource> = makeTable();      // ← add
  const fake: FakePrismaService = {
    example,
    userProfile,
    <resource>,                         // ← add
    // …
    __resetAll() {
      example.__reset();
      userProfile.__reset();
      <resource>.__reset();             // ← add
    },
  };
  return fake;
}
```

Three lines per resource, mechanical. After this is in, the story
test from Step 1 can mount your service and run.

> **Why hand-typed?** `FakePrismaService` is intentionally narrow —
> it's the smallest contract that lets a slim-module service run
> against a `Map<id, row>` instead of a Postgres testcontainer. A
> Proxy-based auto-derived alternative would lose per-resource type
> safety for marginal gain at this scale; the explicit list is the
> deliberate trade-off.

> **Important:** `FakePrisma` does NOT enforce RLS. Tenant isolation
> is the SERVICE'S job (always pass `where: { tenantId }`). For real
> RLS coverage write an e2e spec — the testcontainer Postgres in
> `global-setup.ts` runs the actual `tenant_isolation_<table>`
> policies.

Commit:

```bash
git add tests/lib/fake-prisma.ts && \
  git commit -m "test(<resource>): wire <resource> into fake-prisma"
```

## Step 2 — Prisma model

### Always-on resource

Append to `prisma/schema.prisma`:

```prisma
model <Resource> {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  name      String
  // ... your fields
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([tenantId])
  @@map("<plural_snake_case>")
}
```

Then **always**:

```bash
bun run prepare:schema
bun run prisma:generate
bunx prisma migrate dev --name add_<resource>
```

The `prisma:generate` step is what makes `tx.<resource>.*` typed.
Skip it and you'll fight the type system instead of using it.

### Feature-gated resource

```prisma
// prisma/features/<feature>.prisma
model <Resource> { ... }
```

Same three commands. The feature key must already exist in
`FeaturesSchema` — otherwise schema-concat won't know to include the
file.

### ENUM migrations

PostgreSQL does **not** support `CREATE TYPE … IF NOT EXISTS`. Use
plain `CREATE TYPE` and rely on Prisma's migration lock for
idempotency. If you genuinely need a guard (e.g. a manual SQL script),
use a `DO` block instead:

```sql
-- Wrong — syntax error at or near "NOT":
CREATE TYPE "todo_status" AS ENUM ('open', 'in_progress', 'done') IF NOT EXISTS;

-- Correct — plain CREATE TYPE (idempotent via Prisma migration history):
CREATE TYPE "todo_status" AS ENUM ('open', 'in_progress', 'done');

-- Guard with a DO block when truly needed (manual scripts only):
DO $$ BEGIN
  CREATE TYPE "todo_status" AS ENUM ('open', 'in_progress', 'done');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

All existing migrations in this project use plain `CREATE TYPE`.

### RLS migration

For tenant-scoped tables, the SQL migration must enable RLS and
install the `tenant_isolation` policy. Copy from
`prisma/migrations/20260430000000_example_module/migration.sql`:

```sql
ALTER TABLE "<plural_snake_case>" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "<plural_snake_case>"
  FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true));
```

`PrismaService.runWithRlsTenant(fn, tenantId)` (used by every service
method below) does the `SET LOCAL` so the policy fires.

`bunx prisma migrate dev` does NOT generate the `ENABLE ROW LEVEL
SECURITY` clause for you — the CI gate `bun run check:rls` walks
every tenant-scoped model and fails when no RLS-enabling migration
exists. Run it locally after `prisma migrate dev` to catch a missed
sibling migration before pushing:

```bash
bun run check:rls           # static (always) + runtime (if DATABASE_URL set)
bun run check:rls --runtime # force the live pg_class.relrowsecurity check
bun run check:rls --strict  # fail when runtime check is skipped
```

The runtime mode connects to Postgres and asserts
`pg_class.relrowsecurity = true` per tenant-scoped table — it catches
the failure mode the static scan can't: a migration file edited
*after* it has been applied (Prisma records the file's hash but
doesn't re-run it), leaving the live DB unprotected while the static
scan stays green.

## Step 3 — DTOs

Zod schemas as the single source of truth — runtime validation, type
inference, and OpenAPI schema all derive from one definition:

**DTO fields with defaults:** When a field uses `.default()`, use
`z.input<typeof Schema>` as the service method's parameter type (the
field is optional for callers) and call `Schema.parse(input)` inside
the service to apply the default. `z.infer<>` gives the *output* type
where defaults are already resolved, making the field required — wrong
for a public API parameter.

```typescript
// In <resource>.dto.ts
export const Create<Resource>Schema = z.object({
  title: z.string(),
  status: z.enum(["open", "in_progress", "done"]).default("open"),
});
// z.input<> → status is optional (caller may omit it)
export type Create<Resource>Input = z.input<typeof Create<Resource>Schema>;
// z.infer<> → status is required (default already applied; use for the resolved shape)
export type Create<Resource>Dto = z.infer<typeof Create<Resource>Schema>;

// In <resource>.service.ts
async create(tenantId: string, userId: string, input: Create<Resource>Input) {
  const dto = Create<Resource>Schema.parse(input);  // applies default → dto.status is always a string
  // use dto here
}
```

```typescript
// src/modules/<resource>/<resource>.dto.ts
import { z } from "zod";

export const <Resource>StatusSchema = z.enum(["draft", "published", "archived"]);
export type <Resource>Status = z.infer<typeof <Resource>StatusSchema>;

export const Create<Resource>Schema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  status: <Resource>StatusSchema.default("draft"),
});
export type Create<Resource>Dto = z.infer<typeof Create<Resource>Schema>;

export const Update<Resource>Schema = Create<Resource>Schema.partial();
export type Update<Resource>Dto = z.infer<typeof Update<Resource>Schema>;

export const List<Resource>QuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: <Resource>StatusSchema.optional(),
});
export type List<Resource>Query = z.infer<typeof List<Resource>QuerySchema>;

export const <Resource>ResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: <Resource>StatusSchema,
  createdAt: z.string(),  // ISO string in the DTO; mapper converts Date → string
  updatedAt: z.string(),
});
export type <Resource>Response = z.infer<typeof <Resource>ResponseSchema>;
```

## Step 4 — Service (slim)

Inline the types, errors, mapper, and Prisma calls in **one** file:

```typescript
// src/modules/<resource>/<resource>.service.ts
import { Injectable } from "@nestjs/common";
import type { <Resource> } from "@prisma/client";

import { PrismaService } from "../../core/prisma/prisma.service.js";

import type {
  Create<Resource>Dto,
  <Resource>Response,
  <Resource>Status,
  Update<Resource>Dto,
} from "./<resource>.dto.js";

// ── Errors ─────────────────────────────────────────────────────────

export class <Resource>NotFoundError extends Error {
  constructor(id: string) {
    super(`<Resource> not found: ${id}`);
    this.name = "<Resource>NotFoundError";
  }
}

// ── Service ────────────────────────────────────────────────────────

@Injectable()
export class <Resource>Service {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: Create<Resource>Dto): Promise<<Resource>Response> {
    const record = await this.prisma.runWithRlsTenant(
      (tx) => tx.<resource>.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          name: dto.name,
          description: dto.description ?? null,
          status: dto.status,
        },
      }),
      tenantId,
    );
    return toResponse(record);
  }

  async findById(tenantId: string, id: string): Promise<<Resource>Response> {
    const record = await this.prisma.runWithRlsTenant(
      (tx) => tx.<resource>.findUnique({ where: { id } }),
      tenantId,
    );
    if (!record || record.tenantId !== tenantId) throw new <Resource>NotFoundError(id);
    return toResponse(record);
  }

  // ... list, update, remove — see src/modules/example/example.service.ts
}

// ── Mapping ────────────────────────────────────────────────────────

function toResponse(record: <Resource>): <Resource>Response {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    status: record.status as <Resource>Status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
```

Pattern notes:

- **Imports**: `import type { <Resource> } from '@prisma/client'` —
  fully typed once `prisma:generate` ran.
- **No casts**: `tx.<resource>.create(...)` is typed; the return is
  `Promise<<Resource>>`. If TypeScript disagrees, regenerate, don't
  cast.
- **Tenant scope**: every query is wrapped in
  `prisma.runWithRlsTenant(fn, tenantId)` so RLS sees the right
  `app.tenant_id` setting. The service still passes `tenantId` in
  `where` as defense-in-depth — RLS catches forgotten clauses, the
  explicit filter catches forgotten RLS policies.
- **Don't hand-write `createdAt` / `updatedAt`**: Prisma fills them
  via `@default(now())` / `@updatedAt`. The mapper converts the
  resulting `Date` to ISO string for the DTO.
- **Mapper guards optional fields with `?? null`**: real Prisma
  returns `null` for nullable columns; the in-memory test fake can
  return `undefined`. The `?? null` collapses both to one shape.
- **Errors are named sentinels**: the global RFC 7807 filter maps
  `<Resource>NotFoundError` → 404 by class name match. No
  controller-side try/catch needed.

## Step 5 — Controller

```typescript
// src/modules/<resource>/<resource>.controller.ts
import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query,
} from "@nestjs/common";

import { getCurrentTenantId } from "../../core/multi-tenancy/tenant.interceptor.js";
import { Can } from "../../core/permissions/can.guard.js";
import { ZodValidationPipe } from "../../core/validation/zod-validation.pipe.js";

import {
  type Create<Resource>Dto, Create<Resource>Schema,
  type <Resource>Response,
  type List<Resource>Query, List<Resource>QuerySchema,
  type Update<Resource>Dto, Update<Resource>Schema,
} from "./<resource>.dto.js";
import { <Resource>Service } from "./<resource>.service.js";

@Controller("<plural>")
export class <Resource>Controller {
  constructor(private readonly service: <Resource>Service) {}

  @Can("create", "<Resource>")
  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(Create<Resource>Schema)) dto: Create<Resource>Dto,
  ): Promise<<Resource>Response> {
    return this.service.create(requireTenant(), dto);
  }

  @Can("read", "<Resource>")
  @Get()
  async list(@Query(new ZodValidationPipe(List<Resource>QuerySchema)) query: List<Resource>Query) {
    return this.service.list(requireTenant(), query);
  }

  // ... findOne, update, remove
}

function requireTenant(): string {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    throw new Error("<resource>: no tenant id in request context (route is exempt?)");
  }
  return tenantId;
}
```

The `@Can()` subject string MUST be the capitalised model name —
that's how CASL conditions wire to the record's tenantId / ownerId.
Mismatch silently denies all access.

For `/me/*`-style routes (extending the current user), look at
`src/modules/user-profile/user-profile.controller.ts` — it pulls
`req.user.id` instead of using a URL param.

## Step 6 — Module

```typescript
// src/modules/<resource>/<resource>.module.ts
import { Module } from "@nestjs/common";

import { PrismaModule } from "../../core/prisma/prisma.module.js";

import { <Resource>Controller } from "./<resource>.controller.js";
import { <Resource>Service } from "./<resource>.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [<Resource>Controller],
  providers: [<Resource>Service],
  exports: [<Resource>Service],
})
export class <Resource>Module {}
```

## Step 7 — Wire into AppModule

For always-on resources, add the import:

```typescript
import { <Resource>Module } from "./modules/<resource>/<resource>.module.js";

@Module({
  imports: [
    // ... existing imports
    <Resource>Module,
  ],
})
export class AppModule {}
```

For feature-gated resources:

```typescript
import { features } from "../config/features.js";

@Module({
  imports: [
    ...(features.<feature_key>.enabled ? [<Resource>Module] : []),
    // ...
  ],
})
export class AppModule {}
```

## Step 8 — Grant member access to the new resource

If the new resource is project-facing (i.e. a logged-in tenant member
should be able to CRUD their own rows), wire it into the synthesized
"Member" role catalog so a fresh sign-up doesn't 403 on every
`@Can()`-gated route. Two equivalent shapes — pick the one that suits
the module's lifecycle:

### Option A — `PermissionsModule.forFeature()` from inside the feature module

Idiomatic when the resource is owned end-to-end by the feature module.
The contribution travels with the import; removing the module also
removes the grant.

```typescript
// src/modules/<resource>/<resource>.module.ts
import { Module } from "@nestjs/common";

import { PermissionsModule } from "../../core/permissions/permissions.module.js";
import { PrismaModule } from "../../core/prisma/prisma.module.js";

import { <Resource>Controller } from "./<resource>.controller.js";
import { <Resource>Service } from "./<resource>.service.js";

@Module({
  imports: [
    PrismaModule,
    PermissionsModule.forFeature({ resources: ["<Resource>"] }),
  ],
  controllers: [<Resource>Controller],
  providers: [<Resource>Service],
})
export class <Resource>Module {}
```

For per-user resources (like API keys — bound to the user across
tenants, not to the active tenant), use `perUserResources` instead:

```typescript
PermissionsModule.forFeature({ perUserResources: ["UserNote"] }),
```

### Option B — Single override at AppModule level

Useful when AppModule curates the full extra-resources catalog in one
place (e.g. for projects that prefer a single source of truth):

```typescript
// src/app.module.ts
import { EXTRA_MEMBER_RESOURCES } from "./core/permissions/extra-resources.token.js";

@Module({
  providers: [
    { provide: EXTRA_MEMBER_RESOURCES, useValue: [["Todo"], ["Invoice"]] },
  ],
})
export class AppModule {}
```

The token's value type is `readonly (readonly string[])[]` — one inner
array per logical contribution. The aggregator flat-maps and dedupes
against `DEFAULT_MEMBER_RESOURCES` before emitting the rules.

Skip this step entirely if the resource is admin-only (only the
`/admin/*` UI / a seeded admin Role should reach it) or framework-
internal (`Role`, `Policy`, `Permission`, `Tenant`, `WebhookEndpoint`).

## Step 9 — Regenerate the OpenAPI snapshot (after adding a route)

`tests/stories/openapi-snapshot.story.test.ts` diffs the live OpenAPI
document against the committed `docs/openapi.snapshot.json`. Adding
any new operation (which a fresh feature module always does) will fail
the test until you regenerate the snapshot. Without this step the
six-gates run goes red on what looks like a Todo-related assertion —
fresh contributors lose half an hour chasing it.

```bash
bun run dump:openapi
# OR run the test with the in-place self-update flag:
UPDATE_OPENAPI_SNAPSHOT=1 bun run test:e2e tests/stories/openapi-snapshot.story.test.ts
```

The snapshot is the offline contract the frontend SDK targets — see
[`docs/api-stability-promise.md`](../../docs/api-stability-promise.md).
Commit the regenerated `docs/openapi.snapshot.json` alongside the
module so reviewers can see the API surface change.

## Step 10 — Quality gates

```bash
bun run lint && bun run format && bun run test:types \
  && bun run test:unit && bun run test:e2e \
  && bun run test:coverage && bun run build
```

Coverage on `src/modules/` is gated at **≥ 80 %**. New code without a
story drags the average — write more story tests.

## Step 11 — Commit

```bash
git add -A
git commit -m "feat(<resource>): add module" -m "$(cat <<'EOF'
<short paragraph: what the resource is, who can do what>

<load-bearing fields, indexes, edge cases — what a future reader needs>
EOF
)"
```

## Common gotchas

- **`(tx as any)` is wrong**. If TypeScript says `tx.<resource>`
  doesn't exist, your generator is stale — `bun run prepare:schema &&
bun run prisma:generate`. Cast = bug hidden, not bug fixed.
- **`?? null` in the mapper**. Real Prisma returns `null` for nullable
  columns; `FakePrisma` can return `undefined`. The mapper collapses
  both with `?? null` so tests and production produce identical
  responses.
- **Don't hand-write timestamps**. `@default(now())` / `@updatedAt` in
  the schema do this; manual `new Date().toISOString()` overrides
  that. The mapper does the `Date → ISO` conversion at the DTO
  boundary.
- **Subject naming**: `@Can('read', 'Project')` — the subject MUST be
  the capitalised model name. Mismatch silently denies all access.
- **Tenant scope**: every multi-tenant query is wrapped in
  `runWithRlsTenant`. RLS is the safety net for forgotten WHERE
  tenant_id clauses.
- **`.js` extensions on imports**: even though source is `.ts`. ESM
  `nodenext` resolution.
- **DTO `createdAt: string` vs Prisma `createdAt: Date`**: that's
  intentional. The Date → ISO string conversion happens once in the
  service mapper at the boundary.

---

## Layered pattern (opt-in)

The slim default fits 95 % of cases. Reach for layered when you have
a **specific** reason:

- Multiple storage backends (e.g. Prisma + Redis cache, or a Postgres
  → S3 archival path) where the call site shouldn't care which one
  serves a request.
- Non-Prisma persistence (HTTP API, message queue, in-memory cache as
  primary store).
- A security-test scenario that needs to swap in a paranoid in-memory
  store to assert that no SQL is ever touched.

Layout:

```
src/modules/<resource>/
├── README.md
├── <resource>.module.ts
├── <resource>.controller.ts
├── <resource>.service.ts                ← talks to interface, not Prisma
├── <resource>.dto.ts
├── <resource>.repository.ts             ← interface
├── <resource>.repository.prisma.ts      ← Prisma implementation
├── <resource>.repository.in-memory.ts   ← test/dev implementation
├── <resource>.tokens.ts                 ← DI token (Symbol.for(...))
├── <resource>.types.ts                  ← shared record + status types
├── <resource>.errors.ts                 ← named error sentinels
└── <resource>.mapper.ts                 ← record ↔ DTO transforms
```

The module wires the Prisma implementation via the DI token; tests
can override the provider with the in-memory implementation. The
contract is the interface, not the implementation.

Don't reach for this preemptively. The slim default is faster to
read, faster to change, and the FakePrismaService gives you the same
test ergonomics without the indirection.
