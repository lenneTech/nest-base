# Adding a Feature Module

End-to-end flow for adding a project resource under `src/modules/`. The
`module-scaffolder` agent runs this whole sequence; use this skill when
you want to do it by hand or understand what the agent does.

## When to use this

- Adding a new domain entity (Project, Order, Invoice, ...)
- Carving out a new sub-API (e.g. `/widgets`, `/integrations`)
- Anything that's *project-specific* and doesn't belong in `src/core/`

If the capability is generic enough to benefit every project on the
template → skip this skill, send a PR upstream via
`bun run sync:to-template`.

## The shape

```
src/modules/<resource>/
├── <resource>.module.ts        ← @Module() declaration
├── <resource>.controller.ts    ← REST endpoints, @Can() gates
├── <resource>.service.ts       ← business logic
├── <resource>.dto.ts           ← Zod schemas + createZodDto()
└── <resource>.repository.ts    ← optional; only if BaseRepository isn't enough

prisma/schema.prisma             ← model added here (always-on)
   OR
prisma/features/<feature>.prisma ← model here (feature-gated)

tests/stories/<resource>.story.test.ts  ← red-first
```

## Step 1 — Story tests

Path: `tests/stories/<resource>.story.test.ts`

Cover at minimum:

- `service.create()` happy path + invalid-input rejection
- `service.list()` filtered by tenant
- `service.update()` happy + not-found
- `service.delete()` happy + not-found
- Permission gates: each handler has the right `@Can(action, subject)`
  metadata (mirror the pattern in
  `tests/stories/can-guard.story.test.ts`)
- DTO validation: malformed input rejected with the right Zod issue

Verify red:

```bash
bun run test:e2e tests/stories/<resource>.story.test.ts
```

Commit:

```bash
git add -A
git commit -m "test(<resource>): add red tests for module skeleton"
```

## Step 2 — Prisma model

### Always-on resource

Append to `prisma/schema.prisma`:

```prisma
model <Resource> {
  id        String   @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  tenantId  String   @db.Uuid
  // ... your fields
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId])
  @@map("<plural_snake_case>")
}
```

Run:

```bash
bunx prisma migrate dev --name add-<resource>
```

### Feature-gated resource

Add to a new (or existing) feature schema:

```prisma
// prisma/features/<feature>.prisma
model <Resource> { ... }
```

Then concat + migrate:

```bash
bun run prepare:schema
bunx prisma migrate dev --name add-<resource>
```

The feature key must exist in `FeaturesSchema` — otherwise the
schema-concat planner won't know to include the file.

## Step 3 — DTO

```typescript
// src/modules/<resource>/<resource>.dto.ts
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const Create<Resource>Schema = z.object({
  name: z.string().min(1).max(255),
  // ... other fields
});
export class Create<Resource>Dto extends createZodDto(Create<Resource>Schema) {}

export const Update<Resource>Schema = Create<Resource>Schema.partial();
export class Update<Resource>Dto extends createZodDto(Update<Resource>Schema) {}
```

The schema is the SoT — DTO class generation, OpenAPI schema, and
runtime validation all derive from it.

## Step 4 — Service

```typescript
// src/modules/<resource>/<resource>.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service.js';

@Injectable()
export class <Resource>Service {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.<resource>.findMany({ where: { tenantId } });
  }

  async create(input: Create<Resource>Input, user: { id: string; tenantId: string }) {
    return this.prisma.<resource>.create({
      data: { ...input, tenantId: user.tenantId },
    });
  }

  async getById(id: string, tenantId: string) {
    const found = await this.prisma.<resource>.findFirst({
      where: { id, tenantId },
    });
    if (!found) throw new NotFoundException();
    return found;
  }

  // ... update, delete
}
```

For generic CRUD, extend `BaseRepository` from
`src/core/repository/base-repository.ts` instead of writing the same
pattern by hand.

## Step 5 — Controller

```typescript
// src/modules/<resource>/<resource>.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Can } from '../../core/permissions/can.guard.js';
import { Create<Resource>Dto, Update<Resource>Dto } from './<resource>.dto.js';
import { <Resource>Service } from './<resource>.service.js';

interface AuthedRequest { user: { id: string; tenantId: string } }

@Controller('<plural>')
export class <Resource>Controller {
  constructor(private readonly service: <Resource>Service) {}

  @Get()
  @Can('read', '<Resource>')
  list(@Req() req: AuthedRequest) {
    return this.service.list(req.user.tenantId);
  }

  @Post()
  @Can('create', '<Resource>')
  create(@Body() dto: Create<Resource>Dto, @Req() req: AuthedRequest) {
    return this.service.create(dto, req.user);
  }

  @Get(':id')
  @Can('read', '<Resource>')
  get(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.getById(id, req.user.tenantId);
  }

  @Patch(':id')
  @Can('update', '<Resource>')
  update(@Param('id') id: string, @Body() dto: Update<Resource>Dto, @Req() req: AuthedRequest) {
    return this.service.update(id, dto, req.user);
  }

  @Delete(':id')
  @Can('delete', '<Resource>')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.delete(id, req.user);
  }
}
```

Read methods use `@Can('read', '<Resource>')` so the Output-Pipeline's
record-level filter applies. The `subject` string MUST match the
Prisma model name capitalised — that's how CASL conditions wire to the
record's tenantId / ownerId.

## Step 6 — Module

```typescript
// src/modules/<resource>/<resource>.module.ts
import { Module } from '@nestjs/common';
import { <Resource>Controller } from './<resource>.controller.js';
import { <Resource>Service } from './<resource>.service.js';

@Module({
  controllers: [<Resource>Controller],
  providers: [<Resource>Service],
  exports: [<Resource>Service],
})
export class <Resource>Module {}
```

## Step 7 — Wire into AppModule

Find the project's root module and add the import. For feature-gated
resources, gate the import:

```typescript
import { features } from '../config/features.js';

@Module({
  imports: [
    ...(features.<feature_key>.enabled ? [<Resource>Module] : []),
    // … other modules
  ],
})
export class AppModule {}
```

## Step 8 — Quality gates

```bash
bun run lint && bun run test:unit && bun run test:e2e \
  && bun run test:types && bun run test:coverage && bun run build
```

Coverage on `src/modules/` is gated at **≥ 80 %**. New code without a
story drags the average — write more story tests.

## Step 9 — Commit

```bash
git add -A
git commit -m "feat(<resource>): scaffold module" -m "$(cat <<'EOF'
<short paragraph describing the resource purpose + permission model>

<load-bearing fields, indexes, edge cases>
EOF
)"
```

## Common gotchas

- **Subject naming**: `@Can('read', 'Project')` — the subject MUST be
  the capitalised model name. Mismatch silently denies all access.
- **Tenant scope**: every service method that touches multi-tenant
  data filters by `tenantId`. CASL conditions enforce this at the
  Output-Pipeline; do it in the query too as defense-in-depth.
- **DTO vs Zod schema**: tests use the Zod schema (`Create<Resource>Schema.parse(...)`),
  controllers use the DTO class (`Create<Resource>Dto`). They're the
  same thing — Zod parses through the class.
- **`.js` extensions on imports**: even though source is `.ts`. ESM
  resolution.
