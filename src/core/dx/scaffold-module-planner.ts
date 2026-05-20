/**
 * Pure planner for `bun run add:module <name>` — emit the same slim
 * 5-file scaffold the `module-scaffolder` agent produces, ready for
 * the thin runner in `scripts/add-module.ts` to write to disk.
 *
 * Friction-log run 2026-05-03-14-19-34 entry 14:30: a fresh agent
 * without the slash command / Claude agent resolved had to copy
 * `src/modules/example/` by hand. This planner closes the gap by
 * shipping a shell-callable equivalent.
 *
 * Design — pure planner, thin runner:
 *
 *   - Templating + name validation + idempotency check live here. The
 *     planner is fully unit-testable with no I/O.
 *   - The runner only writes files, runs `bun run prepare:schema`,
 *     and prints the next-steps. It never decides which files to
 *     emit.
 *
 * Scope — what's in the scaffold:
 *
 *   - `src/modules/<name>/<name>.{module,controller,service,dto}.ts`
 *   - `src/modules/<name>/README.md`
 *   - `tests/stories/<name>-module.story.test.ts`
 *
 * Scope — what's deliberately NOT in the scaffold:
 *
 *   - The Prisma model: `prisma migrate dev` is destructive (it
 *     schedules a migration the operator must own). The planner
 *     emits an action-item line in the next-steps walk-through pointing at
 *     `bunx prisma migrate dev --name add_<name>` + the RLS gate
 *     (`scripts/check-rls.ts` from PR #69) that catches missed
 *     `ENABLE ROW LEVEL SECURITY` policies.
 *   - The `AppModule` import wiring: the planner could write the
 *     edit, but doing it via a planner-driven AST patch is fragile
 *     under upstream sync. The next-steps walk-through prints the
 *     exact import + one-line addition the operator drops in.
 *   - The `EXTRA_MEMBER_RESOURCES` provider hook from PR #66 —
 *     project-specific permissions wiring, which the operator owns.
 */

const RESOURCE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export interface ScaffoldModuleInput {
  /** Lowercase kebab-case resource name, singular (e.g. `todo`, `audit-log`). */
  name: string;
  /**
   * The resource names that already exist under `src/modules/`. The
   * runner reads `readdirSync(src/modules)` and feeds that list here;
   * the planner uses it to refuse a partial overwrite.
   */
  existingResources: string[];
}

export interface ScaffoldedFile {
  /** Path relative to the project root. */
  path: string;
  /** Full file content (final byte). */
  content: string;
}

export interface ScaffoldWritePlan {
  action: "write";
  files: ScaffoldedFile[];
  /** Operator-visible walk-through to run after the bytes hit disk. */
  nextSteps: string;
}

export interface ScaffoldAbortPlan {
  action: "abort";
  reason: string;
}

export type ScaffoldPlan = ScaffoldWritePlan | ScaffoldAbortPlan;

export function planScaffoldModule(input: ScaffoldModuleInput): ScaffoldPlan {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error("planScaffoldModule: name is required");
  }
  if (!RESOURCE_NAME.test(input.name)) {
    throw new Error(
      `planScaffoldModule: "${input.name}" is not a valid lowercase kebab-case name (expected /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)`,
    );
  }

  const name = input.name;
  if (input.existingResources.includes(name)) {
    return {
      action: "abort",
      reason: `src/modules/${name}/ already exists — remove it first to regenerate`,
    };
  }

  const ctx = buildNameContext(name);

  const files: ScaffoldedFile[] = [
    { path: `src/modules/${name}/${name}.dto.ts`, content: renderDto(ctx) },
    { path: `src/modules/${name}/${name}.service.ts`, content: renderService(ctx) },
    { path: `src/modules/${name}/${name}.controller.ts`, content: renderController(ctx) },
    { path: `src/modules/${name}/${name}.module.ts`, content: renderModule(ctx) },
    { path: `src/modules/${name}/README.md`, content: renderReadme(ctx) },
    {
      path: `tests/stories/${name}-module.story.test.ts`,
      content: renderStoryTest(ctx),
    },
  ];

  return {
    action: "write",
    files,
    nextSteps: renderNextSteps(ctx),
  };
}

interface NameContext {
  /** kebab-case dir + file basename (`audit-log`). */
  kebab: string;
  /** PascalCase class-stem (`AuditLog`). */
  pascal: string;
  /** camelCase Prisma-property stem (`auditLog`). */
  camel: string;
  /** URL plural for `@Controller(...)` (`audit-logs`). */
  pluralRoute: string;
}

function buildNameContext(kebab: string): NameContext {
  const segments = kebab.split("-");
  const pascal = segments.map((s) => s[0]!.toUpperCase() + s.slice(1)).join("");
  const camel =
    segments[0]! +
    segments
      .slice(1)
      .map((s) => s[0]!.toUpperCase() + s.slice(1))
      .join("");
  const pluralRoute = `${kebab}s`;
  return { kebab, pascal, camel, pluralRoute };
}

function renderDto(ctx: NameContext): string {
  return `/**
 * ${ctx.pascal} DTO — Zod schemas as the single source of truth.
 *
 * The schema drives runtime validation (ZodValidationPipe), OpenAPI
 * schema generation (Swagger reads the inferred shape), and the
 * compile-time TypeScript types via z.infer<>. Tighten the rules
 * (min/max, regex, refinements) for your domain — what's emitted
 * here is the same skeleton \`src/modules/example/\` ships.
 */

import { z } from "zod";

export const ${ctx.pascal}StatusSchema = z.enum(["draft", "published", "archived"]);
export type ${ctx.pascal}Status = z.infer<typeof ${ctx.pascal}StatusSchema>;

/** Body for POST /${ctx.pluralRoute} — server fills id + tenantId + timestamps. */
export const Create${ctx.pascal}Schema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  status: ${ctx.pascal}StatusSchema.default("draft"),
});
export type Create${ctx.pascal}Dto = z.infer<typeof Create${ctx.pascal}Schema>;

/** Body for PATCH /${ctx.pluralRoute}/:id — every field optional. */
export const Update${ctx.pascal}Schema = Create${ctx.pascal}Schema.partial();
export type Update${ctx.pascal}Dto = z.infer<typeof Update${ctx.pascal}Schema>;

/** Query params for GET /${ctx.pluralRoute} — basic cursor pagination + filter. */
export const List${ctx.pascal}QuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: ${ctx.pascal}StatusSchema.optional(),
});
export type List${ctx.pascal}Query = z.infer<typeof List${ctx.pascal}QuerySchema>;

/** Public response shape — no internal fields leak. */
export const ${ctx.pascal}ResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: ${ctx.pascal}StatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ${ctx.pascal}Response = z.infer<typeof ${ctx.pascal}ResponseSchema>;
`;
}

function renderService(ctx: NameContext): string {
  return `/**
 * ${ctx.pascal} service — business logic with Prisma integrated directly.
 *
 * Slim default: no repository abstraction, no DI token, no in-memory
 * variant in production code. The Prisma typed client gives us
 * per-table methods (\`tx.${ctx.camel}.create(...)\`); tests use the
 * fake \`PrismaService\` from \`tests/lib/fake-prisma.ts\`.
 *
 * Tenant isolation runs through \`runWithRlsTenant()\` — every query
 * executes inside a transaction with \`app.tenant_id\` set, so the
 * RLS policy on the \`${ctx.pluralRoute.replace(/-/g, "_")}\` table rejects foreign-tenant
 * rows automatically. The service still passes \`tenantId\` in the
 * \`where\`-clause as defense in depth.
 */

import { Injectable } from "@nestjs/common";
import type { ${ctx.pascal} } from "@prisma/client";

import { ResourceNotFoundError } from "../../core/errors/resource-not-found-error.js";
import {
  type CursorPage,
  type CursorRecord,
  buildCursorPage,
} from "../../core/pagination/cursor.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";

import type {
  Create${ctx.pascal}Dto,
  ${ctx.pascal}Response,
  ${ctx.pascal}Status,
  List${ctx.pascal}Query,
  Update${ctx.pascal}Dto,
} from "./${ctx.kebab}.dto.js";

// ── Errors ──────────────────────────────────────────────────────────

/**
 * Named sentinel for "${ctx.pascal} with id X does not exist (or is in
 * another tenant)". Extends \`ResourceNotFoundError\` so the global
 * \`ProblemDetailsExceptionFilter\` emits 404 + \`CORE_NOT_FOUND\`
 * automatically. Don't roll \`extends Error\` here — that falls
 * through the filter to a 500 + CORE_INTERNAL.
 */
export class ${ctx.pascal}NotFoundError extends ResourceNotFoundError {
  constructor(id: string) {
    super("${ctx.pascal}", id);
    this.name = "${ctx.pascal}NotFoundError";
  }
}

// ── Service ─────────────────────────────────────────────────────────

@Injectable()
export class ${ctx.pascal}Service {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: Create${ctx.pascal}Dto): Promise<${ctx.pascal}Response> {
    const record = await this.prisma.runWithRlsTenant(
      (tx) =>
        tx.${ctx.camel}.create({
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

  async list(
    tenantId: string,
    query: List${ctx.pascal}Query,
  ): Promise<CursorPage<${ctx.pascal}Response & CursorRecord>> {
    const records = await this.prisma.runWithRlsTenant(
      (tx) =>
        tx.${ctx.camel}.findMany({
          where: {
            tenantId,
            ...(query.status ? { status: query.status } : {}),
          },
          orderBy: { createdAt: "desc" },
        }),
      tenantId,
    );
    const startIndex = query.cursor
      ? Math.max(0, records.findIndex((r) => r.id === query.cursor) + 1)
      : 0;
    const page = records.slice(startIndex, startIndex + query.limit + 1);
    return buildCursorPage(
      page.map((r) => ({ ...toResponse(r), id: r.id, sortValue: r.createdAt.toISOString() })),
      query.limit,
    );
  }

  async findById(tenantId: string, id: string): Promise<${ctx.pascal}Response> {
    const record = await this.prisma.runWithRlsTenant(
      (tx) => tx.${ctx.camel}.findUnique({ where: { id } }),
      tenantId,
    );
    if (!record || record.tenantId !== tenantId) throw new ${ctx.pascal}NotFoundError(id);
    return toResponse(record);
  }

  async update(tenantId: string, id: string, dto: Update${ctx.pascal}Dto): Promise<${ctx.pascal}Response> {
    // Verify the record exists in this tenant before issuing the
    // UPDATE. RLS would also block a foreign-tenant write, but the
    // explicit check produces a clean ${ctx.pascal}NotFoundError instead
    // of a generic Prisma error.
    await this.findById(tenantId, id);
    const record = await this.prisma.runWithRlsTenant(
      (tx) =>
        tx.${ctx.camel}.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
          },
        }),
      tenantId,
    );
    return toResponse(record);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.findById(tenantId, id);
    await this.prisma.runWithRlsTenant((tx) => tx.${ctx.camel}.delete({ where: { id } }), tenantId);
  }
}

// ── Mapping helpers ─────────────────────────────────────────────────

function toResponse(record: ${ctx.pascal}): ${ctx.pascal}Response {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    status: record.status as ${ctx.pascal}Status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
`;
}

function renderController(ctx: NameContext): string {
  return `/**
 * ${ctx.pascal} controller — REST endpoints for the ${ctx.kebab} resource.
 *
 * Thin transport layer: validates the body / query (Zod pipe), pulls
 * the active tenant from the AsyncLocalStorage that
 * \`TenantInterceptor\` populates on every non-exempt request, and
 * delegates to \`${ctx.pascal}Service\`. Errors flow through the global
 * RFC 7807 filter.
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";

import { getCurrentTenantId } from "../../core/multi-tenancy/tenant.interceptor.js";
import {
  ApiZodBody,
  ApiZodCreatedResponse,
  ApiZodNoContentResponse,
  ApiZodOkResponse,
  ApiZodParam,
  ApiZodQuery,
} from "../../core/openapi/zod-api-decorators.js";
import { registerZodSchema } from "../../core/openapi/zod-to-openapi.js";
import { Can } from "../../core/permissions/can.guard.js";
import { ZodValidationPipe } from "../../core/validation/zod-validation.pipe.js";

import {
  type Create${ctx.pascal}Dto,
  Create${ctx.pascal}Schema,
  type ${ctx.pascal}Response,
  ${ctx.pascal}ResponseSchema,
  type List${ctx.pascal}Query,
  List${ctx.pascal}QuerySchema,
  type Update${ctx.pascal}Dto,
  Update${ctx.pascal}Schema,
} from "./${ctx.kebab}.dto.js";
import { ${ctx.pascal}Service } from "./${ctx.kebab}.service.js";

// Surface the public response and write payloads as named OpenAPI
// components. The kubb-generated SDK $refs them, so the frontend
// type-imports a single \`${ctx.pascal}\` / \`Create${ctx.pascal}\` / \`Update${ctx.pascal}\`
// interface instead of an inlined object on every endpoint.
registerZodSchema("${ctx.pascal}", ${ctx.pascal}ResponseSchema);
registerZodSchema("Create${ctx.pascal}", Create${ctx.pascal}Schema);
registerZodSchema("Update${ctx.pascal}", Update${ctx.pascal}Schema);

@Controller("${ctx.pluralRoute}")
export class ${ctx.pascal}Controller {
  constructor(private readonly service: ${ctx.pascal}Service) {}

  @Can("create", "${ctx.pascal}")
  @Post()
  @HttpCode(201)
  @ApiZodBody(Create${ctx.pascal}Schema, "Create-payload for a new ${ctx.pascal}.")
  @ApiZodCreatedResponse({ schema: ${ctx.pascal}ResponseSchema, description: "The created ${ctx.pascal}." })
  async create(
    @Body(new ZodValidationPipe(Create${ctx.pascal}Schema)) dto: Create${ctx.pascal}Dto,
  ): Promise<${ctx.pascal}Response> {
    return this.service.create(requireTenant(), dto);
  }

  @Can("read", "${ctx.pascal}")
  @Get()
  @ApiZodQuery(List${ctx.pascal}QuerySchema)
  @ApiZodOkResponse({
    schema: z.object({
      items: z.array(${ctx.pascal}ResponseSchema),
      nextCursor: z.string().nullable(),
    }),
    description: "Cursor-paginated list of ${ctx.pascal}s.",
  })
  async list(@Query(new ZodValidationPipe(List${ctx.pascal}QuerySchema)) query: List${ctx.pascal}Query) {
    return this.service.list(requireTenant(), query);
  }

  @Can("read", "${ctx.pascal}")
  @Get(":id")
  @ApiZodParam("id", z.uuid())
  @ApiZodOkResponse({ schema: ${ctx.pascal}ResponseSchema })
  async findOne(@Param("id") id: string): Promise<${ctx.pascal}Response> {
    return this.service.findById(requireTenant(), id);
  }

  @Can("update", "${ctx.pascal}")
  @Patch(":id")
  @ApiZodParam("id", z.uuid())
  @ApiZodBody(Update${ctx.pascal}Schema, "Partial update — every field optional.")
  @ApiZodOkResponse({ schema: ${ctx.pascal}ResponseSchema })
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(Update${ctx.pascal}Schema)) dto: Update${ctx.pascal}Dto,
  ): Promise<${ctx.pascal}Response> {
    return this.service.update(requireTenant(), id, dto);
  }

  @Can("delete", "${ctx.pascal}")
  @Delete(":id")
  @HttpCode(204)
  @ApiZodParam("id", z.uuid())
  @ApiZodNoContentResponse("${ctx.pascal} deleted.")
  async remove(@Param("id") id: string): Promise<void> {
    await this.service.remove(requireTenant(), id);
  }
}

function requireTenant(): string {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    throw new Error("${ctx.kebab}: no tenant id in request context (route is exempt?)");
  }
  return tenantId;
}
`;
}

function renderModule(ctx: NameContext): string {
  return `import { Module } from "@nestjs/common";

import { PrismaModule } from "../../core/prisma/prisma.module.js";

import { ${ctx.pascal}Controller } from "./${ctx.kebab}.controller.js";
import { ${ctx.pascal}Service } from "./${ctx.kebab}.service.js";

/**
 * ${ctx.pascal}Module — wires the controller and the service.
 *
 * The service depends on \`PrismaService\` (provided by
 * \`PrismaModule\`) for all data access. No repository abstraction
 * needed: tests use the \`tests/lib/fake-prisma\` helper to
 * exercise the service without booting a real Postgres connection.
 */
@Module({
  imports: [PrismaModule],
  controllers: [${ctx.pascal}Controller],
  providers: [${ctx.pascal}Service],
  exports: [${ctx.pascal}Service],
})
export class ${ctx.pascal}Module {}
`;
}

function renderReadme(ctx: NameContext): string {
  return `# ${ctx.pascal} module

Tenant-scoped CRUD resource scaffolded via \`bun run add:module ${ctx.kebab}\`.
Mirrors the slim 5-file pattern used by the \`example\` reference module.

## File layout — slim default, 5 files

\`\`\`
src/modules/${ctx.kebab}/
├── README.md                ← this file
├── ${ctx.kebab}.module.ts       ← @Module wiring
├── ${ctx.kebab}.controller.ts   ← REST endpoints + tenant helper
├── ${ctx.kebab}.service.ts      ← business logic + Prisma calls + types + errors
└── ${ctx.kebab}.dto.ts          ← Zod schemas + inferred types
\`\`\`

## Endpoints

| Method   | Path                      | Behaviour                                             |
| -------- | ------------------------- | ----------------------------------------------------- |
| \`POST\`   | \`/${ctx.pluralRoute}\`     | Create record. 201 on success.                        |
| \`GET\`    | \`/${ctx.pluralRoute}\`     | List records (cursor-paginated, optional status filter). |
| \`GET\`    | \`/${ctx.pluralRoute}/:id\` | Fetch one. 404 when missing or foreign-tenant.        |
| \`PATCH\`  | \`/${ctx.pluralRoute}/:id\` | Patch fields.                                         |
| \`DELETE\` | \`/${ctx.pluralRoute}/:id\` | Remove. 204 on success.                               |

Every handler carries \`@Can('action', '${ctx.pascal}')\` so \`/hub/routes\`
shows the module guarded.

## Next steps after scaffolding

1. **Add the Prisma model.** Append to \`prisma/schema.prisma\`:

   \`\`\`prisma
   model ${ctx.pascal} {
     id          String   @id @default(uuid()) @db.Uuid
     tenantId    String   @map("tenant_id") @db.Uuid
     name        String
     description String?
     status      String   @default("draft")
     createdAt   DateTime @default(now()) @map("created_at")
     updatedAt   DateTime @updatedAt @map("updated_at")

     @@index([tenantId])
     @@map("${ctx.pluralRoute.replace(/-/g, "_")}")
   }
   \`\`\`

2. **Generate the typed client + create the migration:**

   \`\`\`bash
   bun run prepare:schema
   bun run prisma:generate
   bunx prisma migrate dev --name add_${ctx.kebab.replace(/-/g, "_")}
   \`\`\`

3. **Enable RLS in the migration.** Append to the generated SQL:

   \`\`\`sql
   ALTER TABLE ${ctx.pluralRoute.replace(/-/g, "_")} ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON ${ctx.pluralRoute.replace(/-/g, "_")}
     USING (tenant_id::text = current_setting('app.tenant_id', true))
     WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
   \`\`\`

   \`bun run check:rls\` (PR #69) will flag any tenant-scoped model
   that ships without RLS — make sure it stays green.

4. **Wire ${ctx.pascal}Module into AppModule.** Edit \`src/core/app/app.module.ts\`:

   \`\`\`typescript
   import { ${ctx.pascal}Module } from "../../modules/${ctx.kebab}/${ctx.kebab}.module.js";
   // …add ${ctx.pascal}Module to the @Module imports array.
   \`\`\`

5. **(Optional) Add to EXTRA_MEMBER_RESOURCES** if non-admin tenant
   members need to manage this resource. See PR #66 for the multi-
   provider hook.

6. **Run the gates:**

   \`\`\`bash
   bun run lint && bun run test:unit && bun run test:e2e \\
     && bun run test:types && bun run test:coverage && bun run build
   \`\`\`
`;
}

function renderStoryTest(ctx: NameContext): string {
  return `/**
 * Story tests for the ${ctx.pascal} module — exercise the service
 * against the in-memory \`FakePrismaService\` so the tests run fast
 * without booting a Postgres container.
 *
 * Scaffolded by \`bun run add:module ${ctx.kebab}\`. Adjust assertions
 * to the actual fields and behaviours of your resource — the seeded
 * shape mirrors the \`example\` reference.
 *
 * ── RED-first by design ───────────────────────────────────────────────
 *
 * This file ships intentionally RED. The first \`create\` assertion is
 * pinned to a sentinel shape (\`{ __REPLACE_ME__: true }\`) so the
 * scaffolded slice fails the suite immediately — that's the project's
 * RED-first TDD discipline (see CLAUDE.md "How development happens").
 *
 * Workflow for a fresh \`bun run add:module ${ctx.kebab}\`:
 *   1. Run \`bun run test:e2e tests/stories/${ctx.kebab}-module.story.test.ts\` →
 *      see the sentinel assertion fail. That's the RED step.
 *   2. Edit each assertion below to match YOUR domain shape (the
 *      Example-cloned scaffold is just a starting template, not the
 *      target). Drop the \`__REPLACE_ME__: true\` sentinel once your
 *      real expectations are in.
 *   3. Implement the service / DTO until the rewritten assertions
 *      pass. That's the GREEN step.
 *
 * If you're genuinely happy with the Example carbon-copy shape, replace
 * the \`{ __REPLACE_ME__: true }\` line with \`{ name: "${ctx.pascal} one", ... }\`
 * — that flips this slice green.
 */

import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";

import { ResourceNotFoundError } from "../../src/core/errors/resource-not-found-error.js";
import {
  Create${ctx.pascal}Schema,
  List${ctx.pascal}QuerySchema,
} from "../../src/modules/${ctx.kebab}/${ctx.kebab}.dto.js";
import {
  ${ctx.pascal}NotFoundError,
  ${ctx.pascal}Service,
} from "../../src/modules/${ctx.kebab}/${ctx.kebab}.service.js";
import { asPrismaService, createFakePrisma } from "../lib/fake-prisma.js";

const TENANT_A = "00000000-0000-7000-8000-00000000000a";
const TENANT_B = "00000000-0000-7000-8000-00000000000b";

function makeService(): ${ctx.pascal}Service {
  return new ${ctx.pascal}Service(asPrismaService(createFakePrisma()));
}

describe("Story · ${ctx.pascal} module", () => {
  let service: ${ctx.pascal}Service;

  beforeEach(() => {
    service = makeService();
  });

  describe("create", () => {
    it("inserts a record and returns the response shape", async () => {
      const out = await service.create(TENANT_A, {
        name: "${ctx.pascal} one",
        description: "A first ${ctx.kebab}",
        status: "draft",
      });
      // RED-first sentinel — replace with the real shape your
      // controller / SDK consumers expect. The scaffold ships this
      // line failing on purpose so the slice can't go green without
      // a deliberate edit (project RED-first TDD discipline). See the
      // file-header doc-comment for the workflow.
      expect(out).toEqual({ __REPLACE_ME__: true });
      expect(out).toMatchObject({
        name: "${ctx.pascal} one",
        description: "A first ${ctx.kebab}",
        status: "draft",
      });
      expect(out.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("uses the schema default for status when omitted", () => {
      const parsed = Create${ctx.pascal}Schema.parse({ name: "x" });
      expect(parsed.status).toBe("draft");
    });
  });

  describe("list", () => {
    it("returns only the calling tenant's records", async () => {
      await service.create(TENANT_A, { name: "A", status: "draft" });
      await service.create(TENANT_B, { name: "B", status: "draft" });
      const page = await service.list(TENANT_A, { limit: 20 });
      expect(page.items.map((r) => r.name)).toEqual(["A"]);
    });

    it("filters by status", async () => {
      await service.create(TENANT_A, { name: "draft", status: "draft" });
      await service.create(TENANT_A, { name: "published", status: "published" });
      const page = await service.list(TENANT_A, { limit: 20, status: "published" });
      expect(page.items.map((r) => r.name)).toEqual(["published"]);
    });

    it("query schema coerces string limit to number", () => {
      const parsed = List${ctx.pascal}QuerySchema.parse({ limit: "30" });
      expect(parsed.limit).toBe(30);
    });
  });

  describe("findById", () => {
    it("returns the record when it exists in the same tenant", async () => {
      const created = await service.create(TENANT_A, { name: "x", status: "draft" });
      const found = await service.findById(TENANT_A, created.id);
      expect(found.id).toBe(created.id);
    });

    it("throws ${ctx.pascal}NotFoundError when the tenant doesn't match", async () => {
      const created = await service.create(TENANT_A, { name: "x", status: "draft" });
      await expect(service.findById(TENANT_B, created.id)).rejects.toBeInstanceOf(
        ${ctx.pascal}NotFoundError,
      );
    });

    it("throws ${ctx.pascal}NotFoundError on missing id", async () => {
      await expect(service.findById(TENANT_A, "no-such-id")).rejects.toBeInstanceOf(
        ${ctx.pascal}NotFoundError,
      );
    });

    it("${ctx.pascal}NotFoundError extends ResourceNotFoundError → 404 (not 500)", async () => {
      try {
        await service.findById(TENANT_A, "no-such-id");
        throw new Error("expected ${ctx.pascal}NotFoundError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(${ctx.pascal}NotFoundError);
        expect(err).toBeInstanceOf(ResourceNotFoundError);
        expect(err).toBeInstanceOf(NotFoundException);
        expect((err as NotFoundException).getStatus()).toBe(404);
      }
    });
  });

  describe("update", () => {
    it("patches only the supplied fields", async () => {
      const created = await service.create(TENANT_A, {
        name: "old",
        description: "keep me",
        status: "draft",
      });
      const updated = await service.update(TENANT_A, created.id, { name: "new" });
      expect(updated.name).toBe("new");
      expect(updated.description).toBe("keep me");
      expect(updated.status).toBe("draft");
    });

    it("rejects when the record belongs to another tenant", async () => {
      const created = await service.create(TENANT_A, { name: "x", status: "draft" });
      await expect(service.update(TENANT_B, created.id, { name: "y" })).rejects.toBeInstanceOf(
        ${ctx.pascal}NotFoundError,
      );
    });
  });

  describe("remove", () => {
    it("deletes the record and a subsequent fetch throws", async () => {
      const created = await service.create(TENANT_A, { name: "x", status: "draft" });
      await service.remove(TENANT_A, created.id);
      await expect(service.findById(TENANT_A, created.id)).rejects.toBeInstanceOf(
        ${ctx.pascal}NotFoundError,
      );
    });

    it("rejects deletes from another tenant", async () => {
      const created = await service.create(TENANT_A, { name: "x", status: "draft" });
      await expect(service.remove(TENANT_B, created.id)).rejects.toBeInstanceOf(
        ${ctx.pascal}NotFoundError,
      );
    });
  });
});
`;
}

function renderNextSteps(ctx: NameContext): string {
  const tableName = ctx.pluralRoute.replace(/-/g, "_");
  return `Next steps for ${ctx.pascal} (src/modules/${ctx.kebab}/):

  1. Add the Prisma model to prisma/schema.prisma:

     model ${ctx.pascal} {
       id          String   @id @default(uuid()) @db.Uuid
       tenantId    String   @map("tenant_id") @db.Uuid
       name        String
       description String?
       status      String   @default("draft")
       createdAt   DateTime @default(now()) @map("created_at")
       updatedAt   DateTime @updatedAt @map("updated_at")

       @@index([tenantId])
       @@map("${tableName}")
     }

  2. Generate the typed client + create the migration:

     bun run prepare:schema
     bun run prisma:generate
     bunx prisma migrate dev --name add_${ctx.kebab.replace(/-/g, "_")}

  3. Enable Row-Level Security in the migration. Append:

     ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;
     CREATE POLICY tenant_isolation ON ${tableName}
       USING (tenant_id::text = current_setting('app.tenant_id', true))
       WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

     bun run check:rls fails CI if a tenant-scoped table ships
     without RLS — keep it green.

  4. Wire ${ctx.pascal}Module into src/core/app/app.module.ts:

     import { ${ctx.pascal}Module } from "../../modules/${ctx.kebab}/${ctx.kebab}.module.js";
     // …add ${ctx.pascal}Module to the @Module({ imports: [...] }) array.

  5. Regenerate docs/openapi.snapshot.json so the snapshot test stays green:

     bun run dump:openapi
     # OR: UPDATE_OPENAPI_SNAPSHOT=1 bun run test:e2e tests/stories/openapi-snapshot.story.test.ts

     The committed snapshot is the offline contract the frontend SDK
     targets — adding a route changes it. Skipping this step turns
     the snapshot-story test red on what looks like a ${ctx.pascal}-
     related assertion.

  6. (Optional) If non-admin tenant members manage ${ctx.pascal}, add it
     to EXTRA_MEMBER_RESOURCES (PR #66's multi-provider hook).

  7. Story test ships RED on purpose. Edit assertions for your
     domain, then run

     bun run test:e2e tests/stories/${ctx.kebab}-module.story.test.ts

     until it goes green. The scaffolded story file hard-codes a
     \`{ __REPLACE_ME__: true }\` sentinel so the slice can't sneak
     past the gate without a deliberate edit — that's the project's
     RED-first TDD discipline.

  8. Run the six quality gates:

     bun run lint && bun run test:unit && bun run test:e2e \\
       && bun run test:types && bun run test:coverage && bun run build
`;
}
