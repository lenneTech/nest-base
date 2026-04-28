# CLAUDE.md — `prisma/`

Schema + migrations. The schema is split across files:

```
prisma/
├── schema.prisma         ← Core models — always present
├── features/             ← Feature-gated schemas — concat'd by build
│   ├── webhooks.prisma
│   ├── search.prisma
│   ├── mcp.prisma
│   ├── geo.prisma
│   ├── powersync.prisma
│   ├── realtime.prisma
│   └── field-encryption.prisma
└── migrations/           ← Prisma-generated SQL migrations
```

## How concatenation works

`bun run prepare:schema` reads `src/config/features.ts`, picks the
matching `prisma/features/*.prisma` files, and writes a single
`prisma/schema.generated.prisma` for `prisma generate` to consume.

The planner is `src/core/setup/schema-concat.ts` (pure); the runner
script wires `node:fs` + writes the output. Run order:

```bash
bun run prepare:schema
bunx prisma generate
bunx prisma migrate dev   # or migrate deploy in CI
```

## Prisma 7 driver-adapter mode

This project uses Prisma 7's driver-adapter pattern. The connection URL
lives in `prisma.config.ts` (top-level), **not** in `schema.prisma`. The
`PrismaClient` is constructed with `new PrismaPg({ connectionString })`
in `src/core/prisma/prisma.service.ts`.

This means:
- `schema.prisma` has no `datasource db { url = env(...) }` block
- Connection-pool tuning happens in `prisma.config.ts`
- The Postgres driver-adapter (`@prisma/adapter-pg`) is a runtime dep

## UUID v7 default

ID columns use the project's UUID v7 generator (`pg_uuidv7` Postgres
extension + Node-side fallback in `src/core/uuid/`). Schemas declare:

```prisma
model Project {
  id String @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  // ...
}
```

The migration that enables `pg_uuidv7` runs early; new feature
schemas don't need to repeat it.

## Adding a model

### Project-required (always loaded)

Edit `prisma/schema.prisma`. Run `bunx prisma migrate dev --name <change>`.
Commit the schema diff + the generated SQL migration together.

### Feature-gated

1. Add the file: `prisma/features/<feature>.prisma`.
2. Make sure `<feature>` matches a key in `FeaturesSchema` (otherwise the
   schema-concat planner won't know to include it).
3. Run `bun run prepare:schema && bunx prisma migrate dev --name <change>`.
4. Commit the new feature schema + migration. The migration is an
   *opt-in* — projects that don't enable the feature can skip running it
   (the schema-concat planner will leave it out).

## Generated file

`prisma/schema.generated.prisma` is **not** committed (.gitignore'd).
It's a build artifact. Treat it as read-only output of
`prepare:schema`.

## Migrations are forward-only

Per `docs/api-stability-promise.md`, we don't rewrite history of an
already-shipped migration. If a migration is wrong, ship a new
migration that fixes it; don't edit the old one.

## When you touch a schema

- Run `bun run prepare:schema` immediately after — the generated schema
  is the input to `prisma generate`.
- Run `bunx prisma format` to keep the alignment consistent.
- Write the story / e2e test for the new model **before** the migration.
- Be careful with `String?` → `String` (NULL → NOT NULL): backfill the
  NULLs in a separate migration first.
