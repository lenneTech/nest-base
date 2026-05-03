import { describe, expect, it } from "vitest";

import { planScaffoldModule } from "../../src/core/dx/scaffold-module-planner.js";

/**
 * Story · `bun run add:module <name>` planner.
 *
 * Friction-log entry 14:30: the slash command + `module-scaffolder`
 * agent are documented, but there is no shell-callable equivalent. A
 * fresh agent without those tools resolved had to copy
 * `src/modules/example/` by hand. Fix: a pure planner that takes a
 * resource name and returns the exact files (path + contents) the
 * agent would emit. The thin runner (`scripts/add-module.ts`) writes
 * those bytes; the planner alone owns the templating.
 *
 * Three properties locked in here:
 *   - **deterministic**: same input → byte-identical output
 *   - **idempotent abort**: existing module → `{ action: "abort" }`,
 *     not partial overwrite
 *   - **strict naming**: only kebab-or-snake-case lowercase names
 *     pass; uppercase / dots / hyphens-with-uppercase are rejected
 *     with a clear error.
 */
describe("Story · scaffold-module-planner", () => {
  describe("file shape — matches src/modules/example/ name-substituted", () => {
    it("produces the slim 5-file layout (DTO, service, controller, module, README)", () => {
      const plan = planScaffoldModule({
        name: "todo",
        existingResources: [],
      });
      expect(plan.action).toBe("write");
      if (plan.action !== "write") return;
      const paths = plan.files.map((f) => f.path).sort();
      expect(paths).toEqual([
        "src/modules/todo/README.md",
        "src/modules/todo/todo.controller.ts",
        "src/modules/todo/todo.dto.ts",
        "src/modules/todo/todo.module.ts",
        "src/modules/todo/todo.service.ts",
        "tests/stories/todo-module.story.test.ts",
      ]);
    });

    it("controller registers `<Resource>` Zod schemas for the OpenAPI bridge", () => {
      const plan = planScaffoldModule({ name: "todo", existingResources: [] });
      if (plan.action !== "write") throw new Error("expected write plan");
      const controller = plan.files.find((f) => f.path.endsWith("todo.controller.ts"))!.content;
      expect(controller).toContain('registerZodSchema("Todo", TodoResponseSchema);');
      expect(controller).toContain('registerZodSchema("CreateTodo", CreateTodoSchema);');
      expect(controller).toContain('registerZodSchema("UpdateTodo", UpdateTodoSchema);');
      expect(controller).toContain('@Controller("todos")');
      expect(controller).toContain('@Can("create", "Todo")');
      expect(controller).toContain('@Can("read", "Todo")');
      expect(controller).toContain('@Can("update", "Todo")');
      expect(controller).toContain('@Can("delete", "Todo")');
    });

    it("service uses runWithRlsTenant + ResourceNotFoundError extension", () => {
      const plan = planScaffoldModule({ name: "todo", existingResources: [] });
      if (plan.action !== "write") throw new Error("expected write plan");
      const service = plan.files.find((f) => f.path.endsWith("todo.service.ts"))!.content;
      expect(service).toContain("class TodoNotFoundError extends ResourceNotFoundError");
      expect(service).toContain("runWithRlsTenant(");
      expect(service).toContain("tx.todo.create(");
      expect(service).toContain("tx.todo.findMany(");
      expect(service).toContain("tx.todo.delete(");
      expect(service).toContain("import type { Todo } from");
    });

    it("DTO file exposes Create / Update / List / Response Zod schemas", () => {
      const plan = planScaffoldModule({ name: "todo", existingResources: [] });
      if (plan.action !== "write") throw new Error("expected write plan");
      const dto = plan.files.find((f) => f.path.endsWith("todo.dto.ts"))!.content;
      expect(dto).toContain("export const CreateTodoSchema");
      expect(dto).toContain("export const UpdateTodoSchema");
      expect(dto).toContain("export const ListTodoQuerySchema");
      expect(dto).toContain("export const TodoResponseSchema");
      expect(dto).toContain("export type CreateTodoDto");
    });

    it("module wires controller + service and imports PrismaModule", () => {
      const plan = planScaffoldModule({ name: "todo", existingResources: [] });
      if (plan.action !== "write") throw new Error("expected write plan");
      const mod = plan.files.find((f) => f.path.endsWith("todo.module.ts"))!.content;
      expect(mod).toContain("export class TodoModule");
      expect(mod).toContain("controllers: [TodoController]");
      expect(mod).toContain("providers: [TodoService]");
      expect(mod).toContain("PrismaModule");
    });

    it("story test imports from ../lib/fake-prisma + asserts the not-found-error inheritance", () => {
      const plan = planScaffoldModule({ name: "todo", existingResources: [] });
      if (plan.action !== "write") throw new Error("expected write plan");
      const story = plan.files.find((f) =>
        f.path.includes("stories/todo-module.story.test.ts"),
      )!.content;
      expect(story).toContain('"../../src/modules/todo/todo.service.js"');
      expect(story).toContain("TodoService");
      expect(story).toContain("TodoNotFoundError");
      expect(story).toContain("asPrismaService");
      expect(story).toContain("createFakePrisma");
    });
  });

  describe("idempotency", () => {
    it("aborts with a clear reason when the module folder already exists", () => {
      const plan = planScaffoldModule({
        name: "todo",
        existingResources: ["todo"],
      });
      expect(plan.action).toBe("abort");
      if (plan.action !== "abort") return;
      expect(plan.reason).toMatch(/already exists/i);
      expect(plan.reason).toContain("todo");
    });

    it("does not abort when a different resource exists", () => {
      const plan = planScaffoldModule({
        name: "todo",
        existingResources: ["example", "user-profile"],
      });
      expect(plan.action).toBe("write");
    });

    it("produces byte-identical output for the same input (deterministic)", () => {
      const a = planScaffoldModule({ name: "todo", existingResources: [] });
      const b = planScaffoldModule({ name: "todo", existingResources: [] });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });

  describe("name validation", () => {
    it("rejects an uppercase character", () => {
      expect(() => planScaffoldModule({ name: "Todo", existingResources: [] })).toThrow(
        /lowercase|kebab|invalid/i,
      );
    });

    it("rejects a dot in the name", () => {
      expect(() => planScaffoldModule({ name: "my.module", existingResources: [] })).toThrow();
    });

    it("rejects a leading/trailing hyphen", () => {
      expect(() => planScaffoldModule({ name: "-todo", existingResources: [] })).toThrow();
      expect(() => planScaffoldModule({ name: "todo-", existingResources: [] })).toThrow();
    });

    it("rejects a name with spaces", () => {
      expect(() => planScaffoldModule({ name: "todo list", existingResources: [] })).toThrow();
    });

    it("rejects an empty name", () => {
      expect(() => planScaffoldModule({ name: "", existingResources: [] })).toThrow();
    });

    it("accepts a single-segment lowercase name", () => {
      expect(() => planScaffoldModule({ name: "todo", existingResources: [] })).not.toThrow();
    });

    it("accepts a kebab-case multi-segment name like `audit-log`", () => {
      const plan = planScaffoldModule({ name: "audit-log", existingResources: [] });
      expect(plan.action).toBe("write");
      if (plan.action !== "write") return;
      // Class name is PascalCase derived from kebab → AuditLog.
      const service = plan.files.find((f) => f.path.endsWith("audit-log.service.ts"))!.content;
      expect(service).toContain("class AuditLogService");
      expect(service).toContain("class AuditLogNotFoundError");
      // Prisma model property is camelCase → tx.auditLog.*
      expect(service).toContain("tx.auditLog.create(");
      // Controller plural — `<name>s` for the URL path.
      const controller = plan.files.find((f) =>
        f.path.endsWith("audit-log.controller.ts"),
      )!.content;
      expect(controller).toContain('@Controller("audit-logs")');
    });
  });

  describe("next-steps text", () => {
    it("returns the next-steps walk-through pointing at prisma migrate dev + AppModule import", () => {
      const plan = planScaffoldModule({ name: "todo", existingResources: [] });
      if (plan.action !== "write") throw new Error("expected write plan");
      expect(plan.nextSteps).toMatch(/prisma migrate dev/);
      expect(plan.nextSteps).toMatch(/add_todo/);
      expect(plan.nextSteps).toMatch(/AppModule|app\.module/);
      expect(plan.nextSteps).toMatch(/RLS|row[- ]level security/i);
    });
  });
});
