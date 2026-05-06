# CLAUDE.md — `src/modules/`

This is the **project-owned** half of the source tree. The template
sync (`bun run sync:from-template`) **never touches this folder** —
it's yours.

## Reference modules

Two reference implementations ship with the template — copy whichever
matches your scenario:

| Pattern                       | Reference                   | Use when                                                            |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------- |
| **Blank-slate CRUD**          | `src/modules/example/`      | New resource the project owns end-to-end (Project, Order, Invoice). |
| **Extend an existing entity** | `src/modules/user-profile/` | Adding fields to something the core already manages (User, Tenant). |

Read the `README.md` inside each module for the patterns it
demonstrates (RLS, lazy-create, JSONB columns, current-user routes,
etc.).

## What lives here — slim default (5 files)

```
src/modules/<resource>/
├── README.md                  ← what this module demonstrates
├── <resource>.module.ts       ← @Module() declaration (~10 lines)
├── <resource>.controller.ts   ← REST endpoints + @Can() gates
├── <resource>.service.ts      ← business logic + Prisma + types + errors
└── <resource>.dto.ts          ← Zod schemas + inferred types
```

The slim default fits ~95 % of modules. Service uses `PrismaService`
directly via the typed Prisma client (`tx.<resource>.create({...})`),
no repository abstraction, no DI token, no in-memory variant in
production code. Tests run against the in-memory `FakePrismaService`
helper from `tests/lib/fake-prisma.ts` — fast, no Postgres needed.

If you genuinely need mock-swappable storage (multiple backends,
non-Prisma persistence, paranoid security-test isolation): bring back
the `<resource>.repository.ts` interface + Prisma + in-memory split.
The pattern is documented at the bottom of
`.claude/skills/adding-feature-module.md` ("Layered pattern (opt-in)").
The slim default is the default for a reason — don't reach for layered
preemptively.

Add fields to the Prisma schema in:

- `prisma/schema.prisma` — project-required models (always loaded)
- `prisma/features/<feature>.prisma` — feature-gated models (only
  concatenated by `bun run prepare:schema` when the toggle is on)

## Conventions

### Layer wiring (slim)

```
HTTP (controller)
  → @Can() + CanGuard               ← permission gate
  → ZodValidationPipe(<Schema>)      ← runtime validation
  → Service.<method>(tenantId, dto)
    → prisma.runWithRlsTenant(tx => tx.<resource>.<op>({...}), tenantId)
      → Postgres (RLS policy gates by app.tenant_id)
  ← toResponse(record): Date → ISO string at the boundary
  ← Output-Pipeline (filter / fields / secrets / safety-net)
```

You inject what you need from `src/core/`. Don't reach into `src/core/`
internals — only the re-exported symbols are stable (see
`docs/api-stability-promise.md`).

### Permission gates

Every mutating handler takes a `@Can(action, subject)` decorator:

```typescript
import { Can } from '../../core/permissions/can.guard.js';

@Can('create', 'Project')
@Post()
async create(@Body() dto: CreateProjectDto): Promise<ProjectResponse> {
  return this.service.create(requireTenant(), dto);
}
```

The subject string MUST be the capitalised model name (matches the
Prisma model). Mismatch silently denies all access.

### Tenant scoping via RLS

Every Postgres call goes through `prisma.runWithRlsTenant(fn, tenantId)`
which opens a transaction with `SET LOCAL "app.tenant_id" = '<uuid>'`.
The RLS policy on the table refuses foreign-tenant rows automatically —
even a forgotten `WHERE` clause can't leak across tenants. Services
still pass `tenantId` in `where` as defense-in-depth.

### DTOs are Zod schemas

```typescript
import { z } from "zod";

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  status: z.enum(["draft", "published"]).default("draft"),
});
export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;
```

The schema is the single source of truth — types via `z.infer<>`,
runtime validation via `ZodValidationPipe`, OpenAPI schema all derive
from one definition.

### Service uses the typed Prisma client (no casts)

```typescript
import type { Project } from "@prisma/client";

const record = await this.prisma.runWithRlsTenant(
  (tx) => tx.project.create({ data: {...} }),
  tenantId,
);
```

`tx.project.*` and `import type { Project } from '@prisma/client'` are
fully typed once `bun run prisma:generate` ran against the current
schema. **No escape-hatch casts on `tx`** — if TypeScript says
`tx.<resource>` doesn't exist or `Project` isn't exported, the
generator output is stale — regenerate, don't cast.

### Mapper guards optional fields with `?? null`

Real Prisma returns `null` for nullable columns; the in-memory test
fake returns `undefined`. The mapper collapses both to `null` so tests
and production produce identical responses:

```typescript
function toResponse(record: Project): ProjectResponse {
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
```

### Don't hand-write timestamps

`@default(now())` and `@updatedAt` in the schema fill `createdAt` /
`updatedAt`. The mapper does the `Date → ISO string` conversion at
the DTO boundary. Manual `new Date().toISOString()` in the service
overrides Prisma and creates drift between the schema and runtime.

### Tests live in `tests/`, not next to the code

- Story tests in `tests/stories/<resource>-module.story.test.ts` —
  exercise the service against `createFakePrisma()`. Fast, no DB.
- E2E specs in `tests/<resource>.e2e-spec.ts` — real HTTP layer
  through the testcontainer Postgres for `@Can()`, output pipeline,
  RLS round-trip.
- TDD-first: RED before GREEN. See `.claude/skills/running-tdd-slice.md`.

Coverage threshold for `src/modules/` is **≥ 75 %** (vs `src/core/`'s
80 %). New code without a story still drags the average.

## Adding a new resource — outline

The full step-by-step is in `.claude/skills/adding-feature-module.md`:

1. **`prepare:schema && prisma:generate` FIRST** — without this,
   `tx.<resource>.*` isn't typed and you'll waste time fighting the
   compiler.
2. **Story tests** — `tests/stories/<resource>-module.story.test.ts`,
   verified red.
3. **Prisma model** — `schema.prisma` (always-on) or
   `prisma/features/<feature>.prisma` (gated). Run
   `bun run prepare:schema && bun run prisma:generate && bunx prisma migrate dev`.
4. **DTOs** — Zod schemas, `z.infer<>` for types.
5. **Service** — slim, inline types/errors/mapper. `tx.<resource>.*`
   directly. No casts.
6. **Controller** — REST handlers with `@Can()` + `ZodValidationPipe`.
7. **Module** — `@Module({...})` with `PrismaModule` imported.
8. **Wire into AppModule** — import the new module (or gate via
   `features`).
9. **Six gates green** — lint / format / test:types / test:unit /
   test:e2e / test:coverage / build.

## Activation via features

If your resource is opt-in, put the toggle in `src/config/features.ts`
(written by `bun run setup`) and gate the module import in `AppModule`:

```typescript
import { features } from "../config/features.js";

@Module({
  imports: [...(features.myFeature.enabled ? [MyFeatureModule] : [])],
})
export class AppModule {}
```

Feature toggles also gate Prisma schema concatenation, env-var
requirements, and the Dev-Hub link list — wire them once, get
end-to-end zero-cost when off.

## Don't add here

- **Generic capabilities** — if it would benefit _every_ project, send
  a PR to the template via `bun run sync:to-template`. See
  `docs/core-contribution-guide.md`.
- **Test fixtures shared across resources** — `tests/lib/` is the
  shared place (e.g. `tests/lib/fake-prisma.ts`).
- **Cross-resource utilities** — `src/shared/` for types that the
  generated SDK needs to see.

## Reserved subfolders

A few `src/modules/<name>/` subfolders are reserved with a special
contract. They are **project-owned** (sync-immune) but the file shape
inside is fixed by `src/core/`:

- `src/modules/branding/brand.json` — the project brand config
  (issue #5). Schema-validated via `BrandConfigSchema`. Edited via
  `/dev/brand` (writes the file directly), reset via
  `POST /dev/brand/reset`. Falls back to
  `src/core/branding/brand.default.json` when missing.
- `src/modules/email/templates/<name>.tsx` — project-owned email
  templates that override the core templates of the same name.

## On naming

Match what the project actually calls the resource. The template's
permission system, audit log, realtime channels, and audit-browser all
key off the resource name (capitalised; e.g. `Project`, `Order`,
`User`). Pick a name once and stay consistent — renaming cascades.
