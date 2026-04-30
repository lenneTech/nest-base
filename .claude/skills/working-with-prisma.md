# Working with Prisma

This repo uses **Prisma 7 driver-adapter mode**, which is non-obvious
in two ways:

1. The connection URL lives in `prisma.config.ts`, **not** in
   `schema.prisma`.
2. Schemas are concatenated from feature files at build time —
   `prepare:schema` writes the merged result to
   `schema.generated.prisma`.

If you've used Prisma 5 or earlier, both of these will surprise you.
Read this skill before you touch a model, run a migration, or wire a
new Postgres feature.

---

## File map

```
prisma/
├── schema.prisma              ← core (always present)
├── schema.generated.prisma    ← merged output of prepare:schema (.gitignore)
├── features/                  ← feature-gated schemas
│   ├── webhooks.prisma
│   ├── search.prisma
│   ├── geo.prisma
│   └── ...
├── migrations/                ← Prisma-generated SQL
└── (no .env reference here — URL is in prisma.config.ts)

prisma.config.ts               ← `defineConfig({ schema: './prisma/schema.prisma' })`
src/core/prisma/prisma.service.ts  ← `new PrismaPg({ connectionString: env.DATABASE_URL })`
src/core/setup/schema-concat.ts ← pure planner that concatenates features
scripts/prepare-schema.ts       ← thin runner around the planner
```

---

## The driver-adapter pattern

`schema.prisma` has **no** `datasource db { url = env(...) }` block:

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../node_modules/.prisma/client"
}

datasource db {
  provider = "postgresql"
}
```

Connection happens at runtime via `@prisma/adapter-pg`:

```typescript
// src/core/prisma/prisma.service.ts
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
this.client = new PrismaClient({ adapter });
```

This means `prisma studio` cannot find the URL on its own — the
launcher in `src/core/dx/prisma-studio.ts` passes it explicitly:

```typescript
bunx prisma studio --port 5555 --url $DATABASE_URL --browser none
```

Implication: **CI must pass `DATABASE_URL` to any Prisma command**,
including `prisma migrate deploy`. The repo's CI does this via
`testcontainers/postgresql` plus `prisma:migrate` after `prisma:generate`.

---

## Adding a model — project-required

Always-loaded models go in `prisma/schema.prisma`:

```prisma
model Project {
  id        String   @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  name      String
  tenantId  String   @map("tenant_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")

  @@map("projects")
  @@index([tenantId], map: "projects_tenant_id_idx")
}
```

Then:

```bash
bun run prepare:schema
bunx prisma migrate dev --name add_project
```

Commit the schema diff + the generated SQL migration **together** —
they're a unit.

---

## Adding a model — feature-gated

If the model belongs to a toggleable feature, put it in
`prisma/features/<feature>.prisma`. The feature key must match a key
in `FeaturesSchema` (otherwise schema-concat won't include it).

Example: `prisma/features/notifications.prisma`:

```prisma
model Notification {
  id          String   @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  channel     String
  payload     Json
  deliveredAt DateTime? @map("delivered_at")

  @@map("notifications")
}
```

Then:

```bash
bun run prepare:schema       # concatenates features/notifications.prisma
bunx prisma migrate dev --name add_notifications
```

The migration is **opt-in** — projects that don't enable the
`notifications` feature don't have to run it. The schema-concat
planner skips disabled features.

Commit:

- `prisma/features/notifications.prisma` (new)
- `prisma/migrations/<timestamp>_add_notifications/migration.sql`
- Any tests that exercise the model

---

## Conventions

### UUID v7 IDs

Every primary key uses `pg_uuidv7()`:

```prisma
id String @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
```

The `pg_uuidv7` extension is enabled by an early migration. New feature
schemas don't need to repeat the extension.

### snake_case in Postgres, camelCase in TypeScript

```prisma
model Order {
  id           String   @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid       // ← @map
  totalCents   Int      @map("total_cents")
  createdAt    DateTime @default(now()) @map("created_at")

  @@map("orders")                                         // ← @@map
}
```

TS sees `order.tenantId`, Postgres sees `tenant_id`.

### Multi-tenancy via RLS

Tenant-scoped tables have a `tenant_id` column. The
`PrismaService.runWithRlsTenant(tenantId, callback)` helper opens a
transaction with `SET LOCAL app.tenant_id = $1`, so RLS policies see
the right value.

When you write a query that needs to be tenant-aware, wrap it:

```typescript
return this.prisma.runWithRlsTenant(tenantId, async () => {
  return this.prisma.client.order.findMany({ where: { ... } });
});
```

If you forget — RLS denies. The error surfaces clearly; don't disable
RLS as a "fix".

---

## Migrations are forward-only

Per `docs/api-stability-promise.md`: **never rewrite an
already-shipped migration**. If a migration is wrong, ship a new one
that fixes it.

Why: consumers may have already run the wrong migration in production.
A retroactive edit creates drift between `_prisma_migrations` table
state and what the schema expects.

If you absolutely need to fix a recent migration **before it's been
shipped to anyone**, that's the only escape valve — and you tell
the user explicitly.

---

## Test-time database

`tests/global-setup.ts` boots a `postgres:18-alpine` testcontainer
unless `DATABASE_URL` is already set (CI passes one in). Tests run
against that ephemeral container. No persistent state between runs.

Implication: `bun run test:e2e` requires Docker. If it hangs at
"global setup", check Docker is running.

---

## Common failure modes

### "Module '@prisma/client' has no exported member 'X'"

### "Property 'X' does not exist on type 'TransactionClient'"

### "Property 'X' does not exist on type 'PrismaClient'"

All three are the **same root cause**: the generated client in
`node_modules/.prisma/client/` is older than the current
`schema.prisma`. The Prisma model was added (or renamed) but the
generator hasn't run since.

The fix is **never** `(tx as any).x` or `import type { X } from
'somewhere-else'`. Regenerate:

```bash
bun run prepare:schema    # concat feature schemas → schema.generated.prisma
bun run prisma:generate   # rewrite node_modules/.prisma/client
```

After this, `import type { X } from '@prisma/client'` resolves and
`tx.x.*` is fully typed. If TypeScript still complains, restart your
language server / IDE — it can hold a stale snapshot of the d.ts.

This trap is easy to fall into because Bun's runtime resolution can
be more lenient than tsc's compile-time view: tests pass, the LSP
shouts. Treat the LSP shout as "regenerate", not as "cast".

### "Could not resolve '.prisma/client/default'" in build

Same root cause — generated client missing in `node_modules/.prisma`.
The CI workflow includes a "Generate Prisma client" step before each
Prisma-touching job; if you're seeing this in CI, that step is missing.

### "No database URL found" from `prisma studio`

You're invoking `prisma studio` directly without `--url`. Either set
`DATABASE_URL` in the env or pass `--url $DATABASE_URL`. The
`src/core/dx/prisma-studio.ts` launcher handles this for the dev hub.

### `pg_uuidv7` does not exist

Your test database wasn't migrated. The first migration enables the
extension; subsequent ones depend on it. Run `prisma migrate deploy`
against a fresh database.

### "Migration is already applied"

Prisma's `_prisma_migrations` table thinks this migration ran. If
you're sure it hasn't, the table's lying — but more often the
migration name collides with a previous one. Rename your new
migration directory.

---

## Don't

- **Don't add a `datasource db { url = ... }` block to `schema.prisma`.**
  It's intentionally absent for driver-adapter mode.
- **Don't import directly from `prisma/schema.generated.prisma`.**
  It's gitignored and regenerated.
- **Don't hardcode `@@map(name)` to a non-snake_case name.**
  Postgres convention is snake_case throughout the project.
- **Don't bypass `runWithRlsTenant` for tenant-scoped queries.**
  RLS is the safety net for forgotten WHERE tenant_id clauses.
- **Don't edit a shipped migration.** Forward-only — write a new one.
- **Don't forget `bun run prepare:schema` before `prisma generate`.**
  Without it, your feature schemas don't merge into the active set.
