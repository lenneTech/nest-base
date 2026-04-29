import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

/**
 * MCP-Server-Modul (PLAN.md §16 + §32 Phase 6).
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

export class McpServerModule {
  private readonly _server: McpServer;
  private readonly _info: McpServerInfo;
  private readonly tools = new Map<string, McpToolDefinition>();
  private readonly resources = new Map<string, McpResourceDefinition>();

  constructor(info: McpServerInfo) {
    if (!info.name) throw new Error("mcp: server name must be a non-empty string");
    if (!info.version) throw new Error("mcp: server version must be a non-empty string");
    this._info = { name: info.name, version: info.version };
    this._server = new McpServer({ name: info.name, version: info.version });
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
    const parsed = tool.inputSchema ? tool.inputSchema.parse(input) : input;
    return tool.handler(parsed, ctx);
  }
}
