# Code Guidelines

Conventions a quick scan won't teach you. The architecture lives in
[`architecture.md`](./architecture.md); the contribution workflow in
[`../CONTRIBUTING.md`](../CONTRIBUTING.md). This file is the cheat-sheet
for *how to write code that fits*.

If a rule below contradicts what you see in `src/core/`, the code wins
and this doc has drifted — open a PR to fix it.

## TypeScript

- **Strict, no implicit `any`.** No `@ts-ignore`; prefer `@ts-expect-error`
  with a comment if absolutely needed.
- **ESM imports use the `.js` extension** even when the source is `.ts`:
  `import { X } from '../foo.js'`. This is the runtime-correct form;
  TypeScript resolves it transparently.
- **Plain objects, not classes.** Prisma returns plain objects; we
  *keep* them plain end-to-end. No `class-transformer`, no model classes.
- **Public surface is barrel-exported.** Anything `import`-able from a
  `src/core/<area>/index.ts` falls under the
  [API Stability Promise](./api-stability-promise.md). Internal helpers
  live in `_internal/` sub-folders.

## Comments

Default to writing **no comments**. Only add one when the *why* is
non-obvious — a hidden constraint, a subtle invariant, a workaround for
a specific bug, behaviour that would surprise a reader.

```typescript
// Bad — restates the code
loading.value = true;

// Good — explains the constraint
// Provider rate-limits us to 1 req/sec — back off explicitly so retries
// don't compound the problem.
await sleep(1000);
```

UI labels are German; code, comments and commit messages are English.

## Naming

### TypeScript / API

| Element | Convention | Example |
|---|---|---|
| Date-time fields | `*At` suffix | `createdAt`, `publishedAt` |
| Boolean fields | `is*` / `has*` / `can*` prefix | `isPublic`, `hasAvatar`, `canEdit` |
| ID fields | `*Id` suffix | `userId`, `tenantId` |
| Count fields | `*Count` suffix | `memberCount` |
| REST resources | plural | `/projects`, `/files` |
| Action endpoints | kebab-case after the resource | `POST /projects/:id/archive` |
| Internal endpoints | under `/_internal/*` | `/_internal/metrics` |

### Postgres (via Prisma `@map`)

Schema stays camelCase (TypeScript-idiomatic), Postgres columns are
snake_case (Postgres-idiomatic, no quoting needed):

```prisma
model FileFolder {
  id        String   @id @default(uuid()) @db.Uuid
  parentId  String?  @map("parent_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")
  @@map("file_folders")
}
```

**Every** model gets `@@map`; **every** camelCase field gets `@map`.

## Module boundaries

The codebase is a **modular monolith with hard boundaries**:

- One NestJS module per domain (`UsersModule`, `ProjectsModule`, …).
- Modules export **only** public service interfaces — no repositories,
  no internal helpers.
- Cross-module calls go through public service methods. **Never**
  reach into another module's Prisma queries directly.
- Service-extraction (microservice) should be possible without
  rewiring internals.

**`src/core/` is template-owned**, synced to every consumer. Don't
edit it casually — improvements go upstream via
`bun run sync:to-template` (see
[`core-contribution-guide.md`](./core-contribution-guide.md)).

**`src/modules/` is project-owned**, never touched by template sync.

## Repository pattern

Services don't call `this.prisma.project.findMany()` directly. They go
through a thin repository that owns the query logic, soft-delete
filtering, and permission-context merging:

```typescript
@Injectable()
export class ProjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyForUser(userId: string, ctx: PermissionContext) {
    return this.prisma.project.findMany({
      where: { AND: [ctx.itemFilter, { deletedAt: null }] },
      orderBy: { createdAt: 'desc' },
    });
  }
}
```

Why: query reuse, mockable in tests (no full `PrismaClient` mock), one
place to apply soft-delete and permission filters.

## Validation: Zod is the source of truth

```typescript
export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.enum(['draft', 'published']).default('draft'),
});

// Auto-generated DTO class for OpenAPI/Swagger
export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}
```

- **One Zod schema per DTO**, exported from `src/modules/<resource>/dto/`.
- The global `ZodValidationPipe` wraps every handler — never re-validate
  by hand.
- OpenAPI is generated from the same schemas via `nestjs-zod`. If the
  schema is right, the docs are right.

## Permissions on a handler

The default path is **decorator-driven**:

```typescript
@Controller('projects')
export class ProjectsController {
  @Get()
  @Can('read', 'Project')
  async list(@Ability() ability: AppAbility) {
    return this.repo.findMany({
      where: accessibleBy(ability, 'read').Project,
    });
  }

  @Patch(':id')
  @Can('update', 'Project')
  async update(@Param('id') id: string, @Body() dto: UpdateDto, @Ability() ability: AppAbility) {
    const project = await this.repo.getOrThrow(id);
    ForbiddenError.from(ability).throwUnlessCan('update', project);
    const allowed = permittedFieldsOf(ability, 'update', project);
    return this.repo.update(id, pick(dto, allowed));
  }
}
```

For custom (non-CRUD) actions, call `permissions.authorize(user, action, subject)`
explicitly — it throws `ForbiddenException` if denied.

**Never** trust the handler alone:
1. CASL gates the handler.
2. The repository merges the `accessibleBy` filter into the WHERE.
3. RLS is the database backstop.
4. The output pipeline strips secrets and applies field allowlists on
   the way out.

See the [`wiring-permissions`](../.claude/skills/wiring-permissions.md)
skill for the step-by-step.

## Errors: RFC 7807 + structured codes

All errors leave the system as `application/problem+json`:

```json
{
  "type": "https://errors.example.com/CORE_0100",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Session expired",
  "instance": "/v1/projects/123",
  "code": "CORE_0100",
  "errors": [
    { "field": "email", "message": "Invalid format", "code": "VAL_0001" }
  ]
}
```

- **Code format** — `CORE_0100`, `<DOMAIN>_<NNNN>`. No `#` prefix.
- **Registry** — `src/core/errors/error-code-registry.ts` is the SoT.
  Add entries there; never inline a magic string.
- **Translations** belong in the registry entry (`translations.de`,
  `translations.en`).
- **Throwing** — extend the matching `ProblemException` subclass; the
  global filter formats the response.

The [`adding-error-code`](../.claude/skills/adding-error-code.md) skill
walks through it end-to-end.

## HTTP conventions

- **Versioning** — paths under `/v1/...`. v1 is the default mount.
- **Status codes** — 200 read/update, 201 create, 204 delete (no body),
  400 validation, 401 unauth, 403 denied, 404 not found, 409 conflict,
  412 ETag mismatch, 422 semantic validation, 429 rate-limited, 500
  server.
- **Pagination** — `?page=N&limit=M` for UI lists,
  `?starting_after=<id>&limit=N` for bulk/sync. Always emit a `Link`
  header (RFC 5988) with `rel="next"`/`"last"`.
- **Idempotency** — for non-idempotent endpoints (`POST`, `PATCH`),
  honour the `Idempotency-Key` header. Decorate with
  `@RequireIdempotencyKey()`.
- **Optimistic concurrency** — return `ETag: "vN"` on read, accept
  `If-Match: "vN"` on update; mismatch → `412 Precondition Failed`.
- **Soft-delete** — `deletedAt` / `deletedBy` columns; `delete()` soft,
  `hardDelete()` admin-only with audit entry.

## Feature flags

`src/core/features/features.ts` exports `FeaturesSchema` (Zod). Every
project parses its own selection at boot:

```typescript
export const features = FeaturesSchema.parse({
  multiTenancy: { enabled: true },
  webhooks: { enabled: true },
  search: { enabled: false },
  // …
});
```

- **`features.ts` is the single source of truth.** Never hard-code a
  feature toggle anywhere else.
- A disabled feature must have **zero footprint**: no DI registration,
  no route mount, no migration ran, no env var required.
- Add a new flag via the
  [`adding-feature-flag`](../.claude/skills/adding-feature-flag.md)
  skill.

## Pure planners over runners

Every helper in `src/core/dx/`, `src/core/setup/`, the error registry,
the audit pipeline, and any sync-/file-system-touching path follows the
**planner / runner split**:

- **Planner** — pure function. Returns a plan describing what would
  happen. Easy to unit-test.
- **Runner** — thin I/O wrapper. Calls the planner and executes the
  plan.

Why: the planner is testable without mocking the world. The runner is
small enough to eyeball-review.

```typescript
export function planSync(input: SyncInput): SyncPlan { /* pure */ }
export async function runSync(input: SyncInput): Promise<SyncResult> {
  const plan = planSync(input);
  // … execute steps in plan
}
```

When you add a new helper that touches `src/modules/`, the file system,
or permissions, this split is **non-negotiable** — the input gets
validated twice (planner *and* runner) as defense-in-depth.

## HTML rendering

`/admin/*` and `/dev/*` page renderers HTML-escape every
user-controlled value via the standard 5-character table (`& < > " '`).
The Search-Tester is the only renderer that trusts a payload fragment
(`ts_headline`'s `<b>` tags). If you write a new renderer, follow the
escape pattern — see existing renderers in `src/core/dev/` and
`src/core/dx/` for the helper.

## Tests

Test layering and TDD discipline live in
[`../CONTRIBUTING.md`](../CONTRIBUTING.md). The minimum:

| Kind | Location | Tool | What it covers |
|---|---|---|---|
| Story (TDD) | `tests/stories/<feature>.story.test.ts` | Vitest + Supertest | One user journey per file, RED-first |
| E2E | `tests/<feature>.e2e-spec.ts` | Vitest + Supertest | Edge cases per feature (perms, errors, cookies) |
| Unit | `tests/unit/*.spec.ts` | Vitest | Pure functions, planners, helpers |
| Type | `tests/types/*.type-test.ts` | `tsc --noEmit` | Compile-time guarantees on public APIs |
| Migration | `tests/migrate/` | Vitest + Postgres | Up- and down-migrations |
| Performance | `tests/k6/` | k6 | Load/memory tests |

Coverage thresholds: `src/core/` ≥ 90 %, `src/modules/` ≥ 80 %. Failing
the gate means *more tests*, not more exclusions.

**Forbidden**: `it.skip`, `xit`, `--no-verify`, `--force`, coverage
drops, implementation without a prior failing test.

## Bun, not Node

Scripts use Bun. **Never** shell out to `node`/`npm` from a project
script. The `dev`, `build`, `setup`, `prisma:*`, `sync:*` scripts in
`package.json` are the canonical entry points; don't invent parallel
ones.

## Logging

- **Pino** is the logger; OpenTelemetry adds `traceId` / `spanId`.
- **No PII in logs** — emails, names, tokens, IDs in the URL path are
  fine; bodies and headers are not. Use `redact` rules in the Pino
  config when in doubt.
- **W3C `traceparent`** is the request correlation ID — don't
  re-invent.

## Quality bar (pre-commit)

All six gates green before a commit. The aliases are in
`package.json`:

```bash
bun run lint && \
bun run format && \
bun run test:types && \
bun run test:unit && \
bun run test:e2e && \
bun run test:coverage && \
bun run build
```

If a gate fails, fix the underlying cause — don't lower the threshold,
don't `--no-verify`. Coverage drops are not negotiable.
