import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  auditControllerRoutes,
  parseControllerSource,
} from "../../src/core/permissions/route-audit-planner.js";

/**
 * Story · Route-gating audit planner.
 *
 * Pure regex/AST-light planner that walks every controller file under
 * a configurable root, extracts every `@Get/@Post/@Put/@Patch/@Delete`
 * decorator + the surrounding `@Can(...)` / `@Public(...)` decorators
 * + the controller's base path, then classifies each route as:
 *
 *   - `gated`             — handler carries `@Can()`
 *   - `public-by-design`  — handler carries `@Public(reason)` OR full
 *                           path is covered by the jwt-middleware /
 *                           tenant-guard public allowlists
 *   - `ungated-bug`       — neither
 *
 * The planner runs against the live `src/` tree to power the build-time
 * CI gate, but each unit test feeds it a synthetic in-memory fixture so
 * the contract is documented + enforced even before the live tree is
 * clean.
 */
describe("Story · Route-audit planner — parseControllerSource", () => {
  it("extracts a single @Get with @Can() as gated", () => {
    const source = `
      @Controller("widgets")
      class WidgetController {
        @Can("read", "Widget")
        @Get()
        list() {}
      }
    `;
    const result = parseControllerSource({ file: "fake.ts", source });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      file: "fake.ts",
      controllerClass: "WidgetController",
      handler: "list",
      method: "GET",
      path: "/widgets",
      classification: "gated",
      decorators: { can: { action: "read", subject: "Widget" } },
    });
  });

  it("extracts a single @Get with @Public() as public-by-design with reason", () => {
    const source = `
      @Controller("public-things")
      class PublicController {
        @Public("anonymous read for SDK consumers")
        @Get()
        list() {}
      }
    `;
    const [first] = parseControllerSource({ file: "fake.ts", source });
    expect(first?.classification).toBe("public-by-design");
    expect(first?.decorators.public?.reason).toBe("anonymous read for SDK consumers");
  });

  it("flags a route with no decorator as ungated-bug when the path is not allowlisted", () => {
    const source = `
      @Controller("widgets")
      class WidgetController {
        @Get(":id")
        get(@Param("id") id: string) {}
      }
    `;
    const [first] = parseControllerSource({ file: "fake.ts", source });
    expect(first?.classification).toBe("ungated-bug");
    expect(first?.path).toBe("/widgets/:id");
  });

  it("treats /health/* as public-by-design even without @Public()", () => {
    const source = `
      @Controller("health")
      class HealthController {
        @Get("live")
        live() {}
      }
    `;
    const [first] = parseControllerSource({
      file: "fake.ts",
      source,
      publicPrefixes: ["/health/"],
    });
    expect(first?.classification).toBe("public-by-design");
    expect(first?.decorators.allowlistMatch).toBe("/health/");
  });

  it("treats /admin/* and /dev/* as dev-only (public-by-design) by default", () => {
    const source = `
      @Controller("admin")
      class AdminController {
        @Get("widgets")
        listWidgets() {}
      }
    `;
    const [first] = parseControllerSource({
      file: "fake.ts",
      source,
      publicPrefixes: ["/admin/"],
    });
    expect(first?.classification).toBe("public-by-design");
  });

  it("handles multiple HTTP method decorators on the same controller", () => {
    const source = `
      @Controller("widgets")
      class WidgetController {
        @Can("read", "Widget")
        @Get()
        list() {}

        @Can("create", "Widget")
        @Post()
        create() {}

        @Delete(":id")
        remove() {}
      }
    `;
    const result = parseControllerSource({ file: "fake.ts", source });
    expect(result).toHaveLength(3);
    expect(result.map((r) => `${r.method} ${r.path} ${r.classification}`)).toEqual([
      "GET /widgets gated",
      "POST /widgets gated",
      "DELETE /widgets/:id ungated-bug",
    ]);
  });

  it("captures line numbers so failures point at the offending decorator", () => {
    const source = [
      "import { Get, Controller } from '@nestjs/common';",
      "",
      '@Controller("widgets")',
      "class WidgetController {",
      "  @Get()",
      "  list() {}",
      "}",
    ].join("\n");
    const [first] = parseControllerSource({ file: "fake.ts", source });
    expect(first?.line).toBe(5);
  });

  it("handles inline classes inside module files (no `export` keyword)", () => {
    const source = `
      @Controller("api-keys")
      class ApiKeyController {
        @Get(":userId")
        list() {}
      }

      @Module({ controllers: [ApiKeyController] })
      export class ApiKeyModule {}
    `;
    const [first] = parseControllerSource({ file: "api-key.module.ts", source });
    expect(first?.controllerClass).toBe("ApiKeyController");
    expect(first?.path).toBe("/api-keys/:userId");
    expect(first?.classification).toBe("ungated-bug");
  });

  it("normalises a base-path with no leading slash", () => {
    const source = `
      @Controller("api/auth")
      class BetterAuthController {
        @All("*splat")
        handle() {}
      }
    `;
    const [first] = parseControllerSource({
      file: "fake.ts",
      source,
      publicPrefixes: ["/api/auth/"],
    });
    expect(first?.path).toBe("/api/auth/*splat");
    expect(first?.method).toBe("ALL");
    expect(first?.classification).toBe("public-by-design");
  });

  it("handles a controller without an explicit path (root '/')", () => {
    const source = `
      @Controller()
      class AppController {
        @Public("server identity probe")
        @Get()
        index() {}
      }
    `;
    const [first] = parseControllerSource({ file: "fake.ts", source });
    expect(first?.path).toBe("/");
    expect(first?.classification).toBe("public-by-design");
  });

  it('rejects empty `@Public("")` consent at parse time (no string)', () => {
    // The runtime decorator already throws for empty reasons; the
    // planner mirrors that — an empty reason is treated as missing
    // consent (= ungated-bug) so the audit cannot be silenced with `""`.
    const source = `
      @Controller("widgets")
      class WidgetController {
        @Public("")
        @Get()
        list() {}
      }
    `;
    const [first] = parseControllerSource({ file: "fake.ts", source });
    expect(first?.classification).toBe("ungated-bug");
  });
});

describe("Story · Route-audit planner — auditControllerRoutes", () => {
  it("walks every controller file under root and aggregates findings", () => {
    const root = mkdtempSync(join(tmpdir(), "route-audit-"));
    const srcDir = join(root, "src", "core", "fake");
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(
      join(srcDir, "good.controller.ts"),
      `
        @Controller("good")
        export class GoodController {
          @Can("read", "Good")
          @Get()
          list() {}
        }
      `,
    );
    writeFileSync(
      join(srcDir, "bad.controller.ts"),
      `
        @Controller("bad")
        export class BadController {
          @Get()
          list() {}
        }
      `,
    );
    writeFileSync(
      join(srcDir, "module-inline.module.ts"),
      `
        @Controller("inline")
        class InlineController {
          @Public("public OAS catalogue")
          @Get()
          list() {}
        }

        @Module({ controllers: [InlineController] })
        export class InlineModule {}
      `,
    );

    const findings = auditControllerRoutes({
      root,
      publicPrefixes: [],
    });

    const summary = {
      gated: findings.filter((f) => f.classification === "gated").length,
      ungated: findings.filter((f) => f.classification === "ungated-bug").length,
      public: findings.filter((f) => f.classification === "public-by-design").length,
    };

    expect(summary).toEqual({ gated: 1, ungated: 1, public: 1 });
    const offending = findings.find((f) => f.classification === "ungated-bug");
    expect(offending?.path).toBe("/bad");
    expect(offending?.controllerClass).toBe("BadController");
  });
});
