import { z } from "zod";
import { describe, expect, it } from "vitest";

import { McpServerModule, type McpContext } from "../../src/core/mcp/mcp-server.js";
import {
  McpResource,
  McpTool,
  discoverMcpHandlers,
  getMcpResourceMetadata,
  getMcpToolMetadata,
} from "../../src/core/mcp/mcp-decorators.js";

/**
 * Story · @McpTool / @McpResource (PLAN.md §16.4 + §32 Phase 6).
 *
 * Decorators that mark instance methods as MCP tools/resources, plus
 * `discoverMcpHandlers(module, instance)` that walks the prototype,
 * reads the metadata, and calls `registerTool` / `registerResource`
 * with handlers bound to the instance.
 *
 * The handler binding matters — services often reference `this` to
 * delegate to repository / permission layers, and the discovery
 * routine must not detach methods from their class instances.
 */
describe("Story · @McpTool / @McpResource", () => {
  describe("@McpTool metadata", () => {
    it("attaches name + description + inputSchema to the method", () => {
      const Schema = z.object({ message: z.string() });

      class S {
        @McpTool({
          name: "echo",
          description: "Echo input",
          inputSchema: Schema,
          permission: { resource: "echo", action: "invoke" },
        })
        echo(_input: { message: string }, _ctx: McpContext): Promise<unknown> {
          return Promise.resolve({});
        }
      }
      const meta = getMcpToolMetadata(S.prototype, "echo");
      expect(meta?.name).toBe("echo");
      expect(meta?.description).toBe("Echo input");
      expect(meta?.inputSchema).toBe(Schema);
      expect(meta?.permission).toEqual({ resource: "echo", action: "invoke" });
    });

    it("returns undefined for an undecorated method", () => {
      class S {
        plain(): void {}
      }
      expect(getMcpToolMetadata(S.prototype, "plain")).toBeUndefined();
    });
  });

  describe("@McpResource metadata", () => {
    it("attaches uri + description + permission to the method", () => {
      class S {
        @McpResource({
          uri: "mcp://projects",
          description: "All projects",
          permission: { resource: "projects", action: "read" },
        })
        listProjects(_uri: string, _ctx: McpContext): Promise<unknown> {
          return Promise.resolve({});
        }
      }
      const meta = getMcpResourceMetadata(S.prototype, "listProjects");
      expect(meta?.uri).toBe("mcp://projects");
      expect(meta?.description).toBe("All projects");
      expect(meta?.permission).toEqual({ resource: "projects", action: "read" });
    });
  });

  describe("discoverMcpHandlers()", () => {
    it("registers a single @McpTool method on the module", () => {
      class S {
        @McpTool({ name: "echo", inputSchema: z.object({ message: z.string() }) })
        echo(input: { message: string }, _ctx: McpContext): Promise<{ echoed: string }> {
          return Promise.resolve({ echoed: input.message });
        }
      }
      const mod = new McpServerModule({ name: "t", version: "0.0.1" });
      discoverMcpHandlers(mod, new S());
      expect(mod.listTools()).toEqual(["echo"]);
    });

    it("binds the handler to the instance so `this` keeps working", async () => {
      class S {
        prefix = ">>";
        @McpTool({ name: "prefix", inputSchema: z.object({ value: z.string() }) })
        run(input: { value: string }, _ctx: McpContext): Promise<{ out: string }> {
          return Promise.resolve({ out: `${this.prefix} ${input.value}` });
        }
      }
      const mod = new McpServerModule({ name: "t", version: "0.0.1" });
      discoverMcpHandlers(mod, new S());
      const result = await mod.invokeTool("prefix", { value: "hi" }, {});
      expect(result).toEqual({ out: ">> hi" });
    });

    it("registers a single @McpResource method on the module", () => {
      class S {
        @McpResource({ uri: "mcp://projects", description: "All projects" })
        listProjects(_uri: string, _ctx: McpContext): Promise<unknown> {
          return Promise.resolve({ contents: [] });
        }
      }
      const mod = new McpServerModule({ name: "t", version: "0.0.1" });
      discoverMcpHandlers(mod, new S());
      expect(mod.listResources()).toEqual(["mcp://projects"]);
    });

    it("registers multiple tools + resources on the same class", () => {
      class S {
        @McpTool({ name: "a" })
        a(_input: unknown, _ctx: McpContext): Promise<unknown> {
          return Promise.resolve({});
        }
        @McpTool({ name: "b" })
        b(_input: unknown, _ctx: McpContext): Promise<unknown> {
          return Promise.resolve({});
        }
        @McpResource({ uri: "mcp://x" })
        x(_uri: string, _ctx: McpContext): Promise<unknown> {
          return Promise.resolve({ contents: [] });
        }
      }
      const mod = new McpServerModule({ name: "t", version: "0.0.1" });
      discoverMcpHandlers(mod, new S());
      expect(mod.listTools().sort()).toEqual(["a", "b"]);
      expect(mod.listResources()).toEqual(["mcp://x"]);
    });

    it("is a no-op when no methods are decorated", () => {
      class S {
        plain(): void {}
      }
      const mod = new McpServerModule({ name: "t", version: "0.0.1" });
      discoverMcpHandlers(mod, new S());
      expect(mod.listTools()).toEqual([]);
      expect(mod.listResources()).toEqual([]);
    });

    it("skips inherited Object.prototype methods (toString, hasOwnProperty, …)", () => {
      class S {
        @McpTool({ name: "echo" })
        echo(_input: unknown, _ctx: McpContext): Promise<unknown> {
          return Promise.resolve({});
        }
      }
      const mod = new McpServerModule({ name: "t", version: "0.0.1" });
      discoverMcpHandlers(mod, new S());
      expect(mod.listTools()).toEqual(["echo"]);
    });

    it("walks across multiple instances and aggregates registrations", () => {
      class A {
        @McpTool({ name: "a" })
        a(_i: unknown, _c: McpContext): Promise<unknown> {
          return Promise.resolve({});
        }
      }
      class B {
        @McpTool({ name: "b" })
        b(_i: unknown, _c: McpContext): Promise<unknown> {
          return Promise.resolve({});
        }
      }
      const mod = new McpServerModule({ name: "t", version: "0.0.1" });
      discoverMcpHandlers(mod, new A());
      discoverMcpHandlers(mod, new B());
      expect(mod.listTools().sort()).toEqual(["a", "b"]);
    });

    it("propagates duplicate-tool errors from the underlying module", () => {
      class S1 {
        @McpTool({ name: "dup" })
        a(_i: unknown, _c: McpContext): Promise<unknown> {
          return Promise.resolve({});
        }
      }
      class S2 {
        @McpTool({ name: "dup" })
        b(_i: unknown, _c: McpContext): Promise<unknown> {
          return Promise.resolve({});
        }
      }
      const mod = new McpServerModule({ name: "t", version: "0.0.1" });
      discoverMcpHandlers(mod, new S1());
      expect(() => discoverMcpHandlers(mod, new S2())).toThrow(/already registered/i);
    });
  });
});
