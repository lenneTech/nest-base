---
description: Scaffold a new project-owned resource under src/modules/ — controller + service + DTO + module + story tests, all wired to AppModule.
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
  - Glob
---

# /add-module

Scaffolds a new project-specific resource under `src/modules/<name>/`
following the project's conventions (Zod-DTO, tenant-aware service,
permission gates, story tests). This is the **bread-and-butter
command** for adding business logic — most agent sessions will hit
it more often than `/add-feature` or `/add-page`.

> Companion reading: `.claude/skills/adding-feature-module.md` (the
> spec) and `src/modules/example/` (the lived reference).
>
> Shell-callable equivalent: `bun run add:module <name>` — emits the
> same skeleton via `scripts/add-module.ts` driving
> `src/core/dx/scaffold-module-planner.ts`. Useful for fresh agents
> without slash-command resolution and for one-shot CLI scripting.

## Arguments

```
/add-module <name> [--feature-flag <key>]
```

- **`<name>`** — singular, kebab-case (e.g. `order`, `invoice`,
  `widget`). Becomes the URL prefix `/<name>s` (auto-pluralised),
  the module name `<Name>Module`, and the CASL subject `<Name>`.
- **`--feature-flag <key>`** — optional. When set, the module is
  imported via `conditionalImport(features, key, ...)` so it's only
  active when the flag is on. Otherwise it's always-on.

If `<name>` is missing, ask the user.

## Workflow

### 0 · Confirm intent

State the plan back:

> I'll scaffold `src/modules/<name>/` with a Zod-DTO, tenant-aware
> service (in-memory storage by default, swap to Prisma later), REST
> controller (`/<name>s`), and a `<Name>Module` wired into AppModule.
> Story tests cover create / list / find / update / delete.
> Feature-gated: yes/no. Permission subject: `<Name>` (you'll need to
> register it in the CASL catalog separately). Sound right?

Get explicit confirmation. If the user wants Prisma straight away,
ask which schema (`schema.prisma` or `prisma/features/<feature>.prisma`)
and which fields beyond the defaults (id, tenantId, name, timestamps).

### 1 · Red — story test first

`tests/stories/<name>-module.story.test.ts` — copy the structure from
`tests/stories/example-module.story.test.ts`, adapt names and field
names. Cover at minimum:

- `create` happy path + DTO defaults
- `list` filters by tenant (cross-tenant isolation)
- `list` pagination with cursor
- `findById` returns + tenant-isolation rejects + not-found throws
- `update` patches partial + bumps `updatedAt` + cross-tenant rejects
- `remove` deletes + subsequent fetch throws

Run:

```bash
bun run test:e2e tests/stories/<name>-module.story.test.ts
```

Confirm RED. Commit:

```
test(<name>): add red tests for the module skeleton
```

### 2 · Green — implement

Copy from `src/modules/example/` and rename:

```bash
cp -r src/modules/example src/modules/<name>
```

Then in the new folder, find-replace:

- `Example` → `<Name>` (capitalised)
- `example` → `<name>` (lowercase)
- `EXAMPLE_STORAGE` → `<NAME>_STORAGE` (UPPER_SNAKE)

Adapt fields in `<name>.dto.ts` (drop the description if your resource
doesn't need one; tighten validation).

Adapt the storage interface in `<name>.service.ts` to match the field
shape.

### 3 · Wire into AppModule

`src/core/app/app.module.ts` — add the import:

**Always-on**:

```typescript
import { <Name>Module } from "../../modules/<name>/<name>.module.js";

@Module({
  imports: [
    // ... existing
    <Name>Module,
  ],
})
```

**Feature-gated** (when `--feature-flag <key>` was used):

```typescript
imports: [...conditionalImport(features, "<key>", <Name>Module)];
```

### 4 · Permissions (optional but recommended)

The module ships with `@Can('action', '<Name>')` decorators commented
out. To enable:

1. Register `<Name>` as a CASL subject in your permission catalog
   (project-specific — depends where you keep the subject list)
2. Uncomment the `@Can(...)` lines in `<name>.controller.ts`
3. Add a permission test that hits each handler with a user who has
   / doesn't have the ability

Until then the controller is open to any tenant member — fine for
the scaffold, must be tightened before production.

### 5 · Prisma model (optional)

If your module needs persistent storage (default is in-memory):

1. Add the model to `prisma/schema.prisma` (always-on) or
   `prisma/features/<feature>.prisma` (gated):

   ```prisma
   model <Name> {
     id        String   @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
     tenantId  String   @map("tenant_id") @db.Uuid
     name      String
     status    String   @default("draft")
     createdAt DateTime @default(now()) @map("created_at")
     updatedAt DateTime @updatedAt @map("updated_at")

     @@index([tenantId], map: "<name_plural>_tenant_id_idx")
     @@map("<name_plural>")
   }
   ```

2. Generate + migrate (skip if `bun run setup` / `setup --bootstrap`
   already ran on this machine and schema is current):

   ```bash
   bun run prepare:schema
   bun run prisma:generate
   bunx prisma migrate dev --name add_<name>
   ```

3. Add `Prisma<Name>Storage implements <Name>Storage` next to the
   service. Use `prisma.runWithRlsTenant(tenantId, () => ...)` for
   every query — RLS enforces tenant isolation as the safety net.

4. Swap the provider in `<name>.module.ts`:
   ```typescript
   { provide: <NAME>_STORAGE, useClass: Prisma<Name>Storage }
   ```

### 6 · Six gates

```bash
bun run lint && \
bun run format && \
bun run test:types && \
bun run test:unit && \
bun run test:e2e && \
bun run test:coverage && \
bun run build
```

Coverage threshold for `src/modules/` is **≥ 80% lines**. The
in-memory storage helps tests reach that without Postgres.

### 7 · Commit

```
feat(<name>): scaffold src/modules/<name>/ — controller / service / DTO / tests
```

In the body:

- Storage adapter (in-memory by default; Prisma if you wired it)
- Permission subject registered (yes/no)
- Feature-flag gating (yes/no)

## Don't

- **Don't put `<name>` files in `src/modules/<name>/`'s tests** — story
  tests live in `tests/stories/<name>-module.story.test.ts`.
- **Don't reach `tenantId` from `req.body` or `req.query`.** Always
  use `getCurrentTenantId()` — RLS won't trust client-supplied tenants.
- **Don't bypass the storage abstraction.** The `<NAME>_STORAGE`
  injection token is what makes the service testable without Postgres
  and lets you swap in-memory ↔ Prisma without changing the service.
- **Don't import from `src/core/` internals.** Only the re-exported
  symbols are stable (`docs/api-stability-promise.md`).
- **Don't skip the cross-tenant test.** "X belongs to tenant A → tenant
  B cannot read/update/delete X" is the single most important test for
  every module.

## Quick reference — minimal new module

After this command finishes, your module looks like:

```
src/modules/<name>/
├── <name>.dto.ts          ← Zod schemas (Create, Update, Query, Response)
├── <name>.service.ts      ← business logic + Storage interface + InMemory impl
├── <name>.controller.ts   ← REST handlers, ZodValidationPipe, getCurrentTenantId
└── <name>.module.ts       ← @Module() with the storage provider

tests/stories/<name>-module.story.test.ts  ← 14+ tests covering CRUD + tenant
prisma/schema.prisma (or features/<feature>.prisma)  ← optional model
```
