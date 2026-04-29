# CLAUDE.md — `src/modules/`

This is the **project-owned** half of the source tree. The template
sync (`bun run sync:from-template`) **never touches this folder** — it's
yours.

If this directory is empty, the project hasn't added any project-
specific resources yet. That's fine; the core ships enough to run.

## What lives here

One subfolder per resource, conventional NestJS module layout:

```
src/modules/<resource>/
├── <resource>.module.ts        ← @Module() declaration
├── <resource>.controller.ts    ← REST endpoints
├── <resource>.service.ts       ← business logic; depends on PrismaService
├── <resource>.dto.ts           ← Zod schemas + createZodDto() classes
└── <resource>.repository.ts    ← optional; only when BaseRepository is
                                  not enough
```

Add fields to the Prisma schema in:

- `prisma/schema.prisma` — for project-required models (always loaded)
- `prisma/features/<feature>.prisma` — for feature-gated models (loaded
  by `bun run prepare:schema` only when the feature flag is on)

## Conventions

### Layer wiring

```
HTTP (controller)
  → DTO validation (Zod via map-and-validate.pipe)
  → Permission gate (@Can() + CanGuard)
  → Service (business logic)
  → Repository (BaseRepository) → PrismaService → Postgres
  ← Output pipeline (4 stages: filter / fields / secrets / safety-net)
```

You inject what you need from `src/core/`. Don't reach into `src/core/`
internals — only the re-exported symbols are stable (see
`docs/api-stability-promise.md`).

### Permission gates

Every mutating handler takes a `@Can(action, subject)` decorator:

```typescript
import { Can } from '../../core/permissions/can.guard.js';

@Post()
@Can('create', 'Project')
async create(@Body() dto: CreateProjectDto, @Req() req: { user: User }) {
  return this.service.create(dto, req.user);
}
```

The `CanGuard` reads the ability attached to the request (by
`PermissionInterceptor`) and either lets the request through or throws
`ForbiddenException`. Read methods can skip `@Can()` if the
output-pipeline's record-level filter is sufficient.

### DTOs are Zod schemas

```typescript
import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.enum(["draft", "published"]).default("draft"),
});
export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}
```

The schema is the single source of truth — DTO class generation, Swagger
schema, and runtime validation all derive from it.

### Tests live in `tests/`, not next to the code

For consistency with the existing test layout:

- Unit tests in `tests/stories/<resource>.story.test.ts`
- E2E tests in `tests/<resource>.e2e-spec.ts` (real HTTP)
- TDD-first: red test before implementation. The `running-tdd-slice`
  skill walks the procedure.

Coverage threshold for `src/modules/` is **≥ 80 %** (vs `src/core/`'s
90 %). New code without a test still drags the average.

## Adding a new resource — outline

The full step-by-step is in `.claude/skills/adding-feature-module.md`:

1. **Story tests first** — `tests/stories/<resource>.story.test.ts`.
2. **Prisma model** — pick `schema.prisma` (always-on) or
   `prisma/features/<feature>.prisma` (gated). Run
   `bun run prepare:schema && bunx prisma migrate dev`.
3. **DTOs** — Zod schemas + `createZodDto`.
4. **Service** — inherit from BaseRepository if generic CRUD is enough;
   write your own otherwise.
5. **Controller** — REST handlers with `@Can()` + DTO classes.
6. **Module** — `@Module({...})` declaration; export the service if
   other modules need it.
7. **Wire into AppModule** — import the new module.
8. **Run gates** — lint / test:unit / test:e2e / test:types /
   test:coverage / build all green.

## Activation via features

If your resource is opt-in, put the toggle in `src/config/features.ts`
(written by `bun run setup`) and gate the module import in
`AppModule`:

```typescript
import { features } from "../config/features.js";

@Module({
  imports: [
    ...(features.myFeature.enabled ? [MyFeatureModule] : []),
    // …
  ],
})
export class AppModule {}
```

Feature toggles also gate Prisma schema concatenation, env-var
requirements, and the Dev-Hub link list — wire them once, get
end-to-end zero-cost when off.

## Don't add here

- **Generic capabilities** — if it would benefit _every_ project, send a
  PR to the template via `bun run sync:to-template`.
  See `docs/core-contribution-guide.md`.
- **Test fixtures shared across resources** — `tests/lib/` is the
  shared place.
- **Cross-resource utilities** — `src/shared/` for types that the
  generated SDK needs to see.

## On naming

Match what the project actually calls the resource. The template's
permission system, audit log, realtime channels, and audit-browser all
key off the resource name (capitalised; e.g. `Project`, `Order`,
`User`). Pick a name once and stay consistent — renaming cascades.
