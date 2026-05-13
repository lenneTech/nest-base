import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

/**
 * MCP-Server-Modul.
 *
 * Wraps `@modelcontextprotocol/sdk`'s `McpServer` so the rest of the
 * codebase has a single ingress for tool/resource registration. The
 * `@McpTool`/`@McpResource` decorators (next slice) discover handlers
 * and call `registerTool` / `registerResource` here. OAuth-aware
 * transports layer on top in the slice after that.
 *
 * The wrapper deliberately stays at the *registry surface* — list,
 * get, validate, invoke. Live MCP protocol exercise via the SDK's
 * `connect(transport)` happens in the integration suite once the
 * transport is wired into the NestJS adapter.
 */

export interface McpUser {
  id: string;
  tenantId: string;
}

export interface McpContext {
  user?: McpUser;
}

/**
 * Pluggable permission checker injected into `McpServerModule`.
 * Production binding delegates to `PermissionService.abilityFor()`; tests
 * can supply a stub without wiring the full CASL stack.
 */
export interface McpPermissionChecker {
  can(userId: string, tenantId: string, action: string, resource: string): Promise<boolean>;
}

/**
 * Thrown by `invokeTool` when the authenticated user lacks the permission
 * declared on the `@McpTool` decorator.
 */
export class McpForbiddenError extends Error {
  constructor(action?: string, resource?: string) {
    super(
      action && resource ? `mcp: forbidden — cannot ${action} on ${resource}` : "mcp: forbidden",
    );
    this.name = "McpForbiddenError";
  }
}

export interface McpPermission {
  resource: string;
  action: string;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: z.ZodType<unknown>;
  handler: (input: unknown, ctx: McpContext) => Promise<unknown>;
  permission?: McpPermission;
}

export interface McpResourceDefinition {
  uri: string;
  description?: string;
  handler: (uri: string, ctx: McpContext) => Promise<unknown>;
  permission?: McpPermission;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export class McpToolAlreadyRegisteredError extends Error {
  constructor(name: string) {
    super(`mcp: tool "${name}" already registered`);
    this.name = "McpToolAlreadyRegisteredError";
  }
}

export class McpResourceAlreadyRegisteredError extends Error {
  constructor(uri: string) {
    super(`mcp: resource "${uri}" already registered`);
    this.name = "McpResourceAlreadyRegisteredError";
  }
}

export interface McpServerModuleOptions {
  info: McpServerInfo;
  /**
   * Optional permission checker. When provided, `invokeTool` enforces
   * the `permission` declared on each `@McpTool` definition against
   * the authenticated user in the context. When absent the permission
   * check is skipped (backward-compat path for projects that haven't
   * wired CASL yet).
   */
  permissionChecker?: McpPermissionChecker;
}

export class McpServerModule {
  private readonly _server: McpServer;
  private readonly _info: McpServerInfo;
  private readonly tools = new Map<string, McpToolDefinition>();
  private readonly resources = new Map<string, McpResourceDefinition>();
  private readonly permissionChecker?: McpPermissionChecker;

  constructor(infoOrOptions: McpServerInfo | McpServerModuleOptions) {
    // Accept both legacy `McpServerInfo` shape and the new options object.
    const opts: McpServerModuleOptions =
      "info" in infoOrOptions
        ? (infoOrOptions as McpServerModuleOptions)
        : { info: infoOrOptions as McpServerInfo };

    if (!opts.info.name) throw new Error("mcp: server name must be a non-empty string");
    if (!opts.info.version) throw new Error("mcp: server version must be a non-empty string");
    this._info = { name: opts.info.name, version: opts.info.version };
    this._server = new McpServer({ name: opts.info.name, version: opts.info.version });
    this.permissionChecker = opts.permissionChecker;
  }

  get info(): McpServerInfo {
    return { ...this._info };
  }

  get server(): McpServer {
    return this._server;
  }

  registerTool(definition: McpToolDefinition): void {
    if (!definition.name) throw new Error("mcp: tool name must be a non-empty string");
    if (typeof definition.handler !== "function") {
      throw new Error("mcp: tool handler must be a function");
    }
    if (this.tools.has(definition.name)) {
      throw new McpToolAlreadyRegisteredError(definition.name);
    }
    this.tools.set(definition.name, definition);
  }

  registerResource(definition: McpResourceDefinition): void {
    if (!definition.uri) throw new Error("mcp: resource uri must be a non-empty string");
    if (this.resources.has(definition.uri)) {
      throw new McpResourceAlreadyRegisteredError(definition.uri);
    }
    this.resources.set(definition.uri, definition);
  }

  listTools(): string[] {
    return [...this.tools.keys()];
  }

  listResources(): string[] {
    return [...this.resources.keys()];
  }

  getTool(name: string): McpToolDefinition | undefined {
    return this.tools.get(name);
  }

  getResource(uri: string): McpResourceDefinition | undefined {
    return this.resources.get(uri);
  }

  async invokeTool(name: string, input: unknown, ctx: McpContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`mcp: unknown tool "${name}"`);

    // MAJ-1: enforce the permission declared on the @McpTool decorator.
    // When a checker is wired and the tool declares a required permission,
    // verify the authenticated user has the ability before invoking the handler.
    if (tool.permission && ctx.user && this.permissionChecker) {
      const allowed = await this.permissionChecker.can(
        ctx.user.id,
        ctx.user.tenantId,
        tool.permission.action,
        tool.permission.resource,
      );
      if (!allowed) {
        throw new McpForbiddenError(tool.permission.action, tool.permission.resource);
      }
    }

    const parsed = tool.inputSchema ? tool.inputSchema.parse(input) : input;
    return tool.handler(parsed, ctx);
  }
}
