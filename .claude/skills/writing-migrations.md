# Writing Migrations

How to add or change a Prisma model in this repo without breaking
schema-concat, RLS, the driver-adapter mode, or the six gates.

This skill exists because Prisma 7 + driver-adapter + feature-gated
schemas + RLS adds enough nuance that "just run `prisma migrate dev`"
is not the right answer.

## When to reach for this skill

- Adding a new model
- Adding a column to an existing model
- Renaming or dropping a column / model
- Adding an index or constraint
- Enabling RLS on a new tenant-scoped table

## The 5-step pattern

### 1 · Decide where the model lives

Two options:

| Question | Where the model goes |
|---|---|
| Does every consumer of this template need it? | `prisma/schema.prisma` (template-owned) |
| Is it gated by a feature flag? | `prisma/features/<feature>.prisma` |
| Is it project-specific (only your downstream project)? | `prisma/schema.prisma` *in your project* — but DO NOT commit changes to the template's `prisma/schema.prisma` from the consumer side |

**Why this matters:** `prisma/features/*.prisma` files are concatenated
into `schema.generated.prisma` only when the matching feature is
enabled (`bun run prepare:schema` reads `features.ts` and includes
the right files). If you put a feature-gated model into the main
schema, it's always present even when the feature is off.

### 2 · Edit the schema

Standard Prisma:

```prisma
model Invoice {
  id         String   @id @default(uuid()) @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  number     String
  status     String
  createdAt  DateTime @default(now()) @map("created_at")

  @@map("invoices")
  @@index([tenantId])
}
```

Conventions in this repo:

- **UUID primary keys**, with `@db.Uuid` (Postgres-typed, not text)
- **snake_case columns** in DB (`@map("...")`), camelCase in TypeScript
- **`@@map("plural_snake")`** for table names — Postgres convention
- **`tenantId` column on every tenant-scoped table** with an index
- **`createdAt` / `updatedAt`** when records have a lifecycle
- **No `@default(autoincrement())`** — UUID v7 (time-ordered) is the
  convention; the repository layer generates it

### 3 · Run schema-concat + create migration

The order matters:

```bash
# 1. Concatenate base schema + active feature schemas
bun run prepare:schema

# 2. Create the migration (Prisma reads schema.generated.prisma)
bunx prisma migrate dev --name add_invoice_model

# 3. Generate the client so TS picks up the new types
bunx prisma generate
```

**Why prepare:schema first:** `prisma migrate dev` reads
`schema.generated.prisma`, not the source. If you skip the concat
step, Prisma sees a stale schema and may generate an empty migration
or, worse, drop tables for features that should be active.

### 4 · Add RLS for tenant-scoped tables

The migration Prisma generated only handles columns/indexes. RLS
policies are SQL. Open `prisma/migrations/<timestamp>_add_invoice_model/migration.sql`
and append:

```sql
-- Enable RLS so RLS-aware queries see only their tenant's rows
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Single policy: row visible iff its tenant_id matches the session-local
-- variable set by the Prisma extension (`SET app.tenant_id = $1`)
CREATE POLICY invoices_tenant_isolation ON invoices
  USING (tenant_id::text = current_setting('app.tenant_id', true));
```

Verify the migration is idempotent — `prisma migrate deploy` runs it
once per `_prisma_migrations` row, but if you reset the DB the
policy must re-create cleanly.

### 5 · Write the story test FIRST (red), then run

Before running the migration, write a story test that asserts the
new shape:

```typescript
// tests/stories/invoice.story.test.ts
describe("Story · Invoice model", () => {
  it("persists tenantId, number, status", async () => {
    const repo = new InvoiceRepository(prisma);
    const created = await repo.create({
      tenantId: 't-1', number: 'INV-001', status: 'open',
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("RLS hides invoices from other tenants", async () => {
    // setSessionTenant('t-1'); create -> visible
    // setSessionTenant('t-2'); same query -> empty
  });
});
```

Verify red: `bun run test:e2e tests/stories/invoice.story.test.ts`
fails because the model doesn't exist. Then run the migration. Then
run the test again — green.

### 6 · Six gates + commit

```bash
bun run lint && \
bun run format && \
bun run test:types && \
bun run test:unit && \
bun run test:e2e && \
bun run test:coverage && \
bun run build
```

Commit the migration AND the test together:

```bash
git add prisma/migrations/<new>/ tests/stories/invoice.story.test.ts \
        src/modules/invoice/  # or src/core/, depending on placement

git commit -m "feat(invoice): add Invoice model with RLS"
```

## Pitfalls

### ❌ Editing `schema.generated.prisma` directly

`prepare:schema` overwrites it on every run. Edit the source files
(`prisma/schema.prisma` or `prisma/features/*.prisma`) instead.

### ❌ Forgetting `prisma generate` after a migration

The Prisma client is regenerated into `node_modules/.prisma/client/`.
Without `prisma generate`, your TypeScript still sees the old types.
Symptom: `Property 'invoice' does not exist on type 'PrismaClient'`.

### ❌ Adding an enum to the schema and forgetting the cast

Postgres enums in Prisma generate `CHECK` constraints by default.
For columns that may need future enum extension, prefer `String` +
runtime validation (Zod). For genuinely closed sets (`status: 'open'
| 'paid' | 'void'`), Prisma's `enum` is fine but adds a small
migration cost on every value change.

### ❌ Skipping RLS on a tenant-scoped table

RLS is the second perimeter behind the application-layer permission
model. A bug in `accessibleBy()` could leak rows; RLS is the safety
net. Every column named `tenant_id` should be backed by a policy.

### ❌ Renaming a column without a data migration

`prisma migrate dev` defaults to dropping the old column and adding
a new one — your data dies. For renames, use a 2-step migration:

1. Add the new column, copy data: `UPDATE foo SET new_col = old_col;`
2. In a follow-up migration (next slice): drop the old column

### ❌ Running migrations against production from the dev script

`bun run prisma:migrate` is `prisma migrate deploy`, not
`migrate dev`. Production picks up new migrations on container
boot via the deploy command. Local dev uses `migrate dev` (creates
the migration file + applies it).

## Driver-Adapter quirks (Prisma 7)

The repo uses Prisma 7's driver-adapter mode (URL lives in
`prisma.config.ts`, not the schema). Two things to know:

- **`DATABASE_URL` is read by the driver, not by Prisma's CLI**. The
  CLI for migrate operations needs the env-var set; `bun run dev`
  passes it through scripts/dev.ts.
- **`prisma migrate dev` may complain about not finding the URL**.
  Fix: check `prisma.config.ts` is exporting it from `process.env.DATABASE_URL`.

## Related skills

- `working-with-prisma.md` — Prisma 7 + driver-adapter setup
- `running-tdd-slice.md` — the red-green-refactor cycle this skill plugs into
- `adding-feature-flag.md` — where feature-gated schemas come from

## Don't

- **Don't `migrate reset` on production**. The flag exists for a
  reason but not on shared databases.
- **Don't squash migrations** that have already shipped to consumers.
  Migration files are an append-only log.
- **Don't bypass `prepare:schema`** by hand-editing
  `schema.generated.prisma`. The next run overwrites your work.
- **Don't skip the story test**. A migration without a test is the
  most common source of silent regressions in this repo.
