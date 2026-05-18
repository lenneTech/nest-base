import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  McpServerModule,
  McpToolAlreadyRegisteredError,
  McpForbiddenError,
  McpResourceAlreadyRegisteredError,
  type McpContext,
  type McpPermissionChecker,
  type McpToolDefinition,
} from "../../src/core/mcp/mcp-server.js";

/**
 * Story · MCP-Server-Modul.
 *
 * The module wraps `@modelcontextprotocol/sdk`'s `McpServer` and gives
 * us a single ingress for tool + resource registration. Decorators
 * (next slice) will discover handlers and call into `registerTool` /
 * `registerResource` here. Auth wiring (slice after that) layers an
 * OAuth-aware transport on top.
 *
 * The slice stays at the registry surface — connect/close lifecycle,
 * no-duplicates, listTools/listResources. End-to-end protocol exercise
 * via InMemoryTransport lives in the integration suite once we have a
 * full transport story.
 */
describe("Story · MCP-Server-Modul", () => {
  function newModule(): McpServerModule {
    return new McpServerModule({ name: "test-server", version: "0.0.1" });
  }

  function tool(overrides: Partial<McpToolDefinition> = {}): McpToolDefinition {
    return {
      name: "echo",
      description: "Echo input back",
      inputSchema: z.object({ message: z.string() }),
      handler: async (input: unknown) => ({ echoed: (input as { message: string }).message }),
      ...overrides,
    };
  }

  describe("construction", () => {
    it("rejects an empty server name", () => {
      expect(() => new McpServerModule({ name: "", version: "0.0.1" })).toThrow(/name/i);
    });

    it("rejects an empty server version", () => {
      expect(() => new McpServerModule({ name: "test", version: "" })).toThrow(/version/i);
    });

    it("exposes name + version through the info getter", () => {
      const mod = new McpServerModule({ name: "srv", version: "1.2.3" });
      expect(mod.info).toEqual({ name: "srv", version: "1.2.3" });
    });
  });

  describe("registerTool", () => {
    it("records a tool definition", () => {
      const mod = newModule();
      mod.registerTool(tool());
      expect(mod.listTools()).toEqual(["echo"]);
    });

    it("records multiple tools with distinct names", () => {
      const mod = newModule();
      mod.registerTool(tool({ name: "a" }));
      mod.registerTool(tool({ name: "b" }));
      expect(mod.listTools().sort()).toEqual(["a", "b"]);
    });

    it("throws McpToolAlreadyRegisteredError on duplicate name", () => {
      const mod = newModule();
      mod.registerTool(tool());
      expect(() => mod.registerTool(tool())).toThrow(McpToolAlreadyRegisteredError);
    });

    it("rejects a tool without a name", () => {
      const mod = newModule();
      expect(() => mod.registerTool(tool({ name: "" }))).toThrow(/name/i);
    });

    it("rejects a tool without a handler", () => {
      const mod = newModule();
      expect(() => mod.registerTool({ ...tool(), handler: undefined as never })).toThrow(
        /handler/i,
      );
    });

    it("returns the registered tool by name through getTool()", () => {
      const mod = newModule();
      const def = tool();
      mod.registerTool(def);
      expect(mod.getTool("echo")?.description).toBe("Echo input back");
      expect(mod.getTool("missing")).toBeUndefined();
    });
  });

  describe("registerResource", () => {
    it("records a resource definition", () => {
      const mod = newModule();
      mod.registerResource({
        uri: "mcp://projects",
        description: "All projects",
        handler: async () => ({ contents: [] }),
      });
      expect(mod.listResources()).toEqual(["mcp://projects"]);
    });

    it("throws McpResourceAlreadyRegisteredError on duplicate uri", () => {
      const mod = newModule();
      const def = {
        uri: "mcp://projects",
        description: "All projects",
        handler: async () => ({ contents: [] }),
      };
      mod.registerResource(def);
      expect(() => mod.registerResource(def)).toThrow(McpResourceAlreadyRegisteredError);
    });

    it("rejects a resource without a uri", () => {
      const mod = newModule();
      expect(() =>
        mod.registerResource({ uri: "", handler: async () => ({ contents: [] }) }),
      ).toThrow(/uri/i);
    });
  });

  describe("lifecycle", () => {
    it("handler is invoked through invokeTool with the parsed input", async () => {
      const mod = newModule();
      const calls: Array<{ input: unknown; ctx: McpContext }> = [];
      mod.registerTool(
        tool({
          handler: async (input, ctx) => {
            calls.push({ input, ctx });
            return { status: "ok" };
          },
        }),
      );
      const result = await mod.invokeTool(
        "echo",
        { message: "hi" },
        { user: { id: "u1", tenantId: "t1" } },
      );
      expect(result).toEqual({ status: "ok" });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.input).toEqual({ message: "hi" });
      expect(calls[0]?.ctx.user).toEqual({ id: "u1", tenantId: "t1" });
    });

    it("invokeTool throws when the tool is unknown", async () => {
      const mod = newModule();
      await expect(mod.invokeTool("ghost", {}, {})).rejects.toThrow(/unknown.*ghost/i);
    });

    it("invokeTool validates the input against the tool inputSchema", async () => {
      const mod = newModule();
      mod.registerTool(tool());
      await expect(mod.invokeTool("echo", { message: 42 }, {})).rejects.toThrow();
    });

    it("exposes the underlying McpServer via the server getter", () => {
      const mod = newModule();
      expect(mod.server).toBeDefined();
      expect(typeof mod.server.connect).toBe("function");
    });
  });

  /**
   * CRIT-1: permission check must be fail-closed.
   *
   * When a tool declares a `permission` but no `permissionChecker` is
   * wired, invokeTool MUST throw McpForbiddenError rather than silently
   * allowing the call. A missing checker is an operator-configuration
   * error — fail-closed is the only safe default.
   */
  describe("permission enforcement (CRIT-1 — fail-closed)", () => {
    function permTool(overrides: Partial<McpToolDefinition> = {}): McpToolDefinition {
      return {
        name: "admin-tool",
        description: "Requires admin permission",
        handler: async () => ({ ok: true }),
        permission: { action: "manage", resource: "User" },
        ...overrides,
      };
    }

    it("throws McpForbiddenError when tool has permission but no permissionChecker is wired", async () => {
      // No permissionChecker in options → fail-closed
      const mod = new McpServerModule({ info: { name: "test", version: "1" } });
      mod.registerTool(permTool());
      await expect(mod.invokeTool("admin-tool", {}, {})).rejects.toThrow(McpForbiddenError);
    });

    it("throws McpForbiddenError when tool has permission but no permissionChecker and ctx has user", async () => {
      const mod = new McpServerModule({ info: { name: "test", version: "1" } });
      mod.registerTool(permTool());
      const ctx: McpContext = { user: { id: "u1", tenantId: "t1" } };
      await expect(mod.invokeTool("admin-tool", {}, ctx)).rejects.toThrow(McpForbiddenError);
    });

    it("throws McpForbiddenError when the permissionChecker denies the call", async () => {
      const denyAll: McpPermissionChecker = {
        can: async () => false,
      };
      const mod = new McpServerModule({
        info: { name: "test", version: "1" },
        permissionChecker: denyAll,
      });
      mod.registerTool(permTool());
      const ctx: McpContext = { user: { id: "u1", tenantId: "t1" } };
      await expect(mod.invokeTool("admin-tool", {}, ctx)).rejects.toThrow(McpForbiddenError);
    });

    it("invokes the handler when the permissionChecker grants the call", async () => {
      const allowAll: McpPermissionChecker = {
        can: async () => true,
      };
      const mod = new McpServerModule({
        info: { name: "test", version: "1" },
        permissionChecker: allowAll,
      });
      mod.registerTool(permTool());
      const ctx: McpContext = { user: { id: "u1", tenantId: "t1" } };
      const result = await mod.invokeTool("admin-tool", {}, ctx);
      expect(result).toEqual({ ok: true });
    });

    it("invokes the handler for a tool without a permission (no auth required)", async () => {
      // Tool with no permission field: checker not consulted, always executes.
      const mod = new McpServerModule({ info: { name: "test", version: "1" } });
      mod.registerTool(tool({ name: "open-tool", permission: undefined }));
      const result = await mod.invokeTool("open-tool", { message: "hi" }, {});
      expect(result).toEqual({ echoed: "hi" });
    });
  });
});
