import "reflect-metadata";
import type { z } from "zod";

import { type McpContext, type McpPermission, type McpServerModule } from "./mcp-server.js";

/**
 * @McpTool / @McpResource decorators + auto-discovery (PLAN.md §16.4 +
 * §32 Phase 6).
 *
 * Decorators stamp metadata onto the prototype method via
 * reflect-metadata (the same mechanism the @Can()/CanGuard pair uses
 * elsewhere in the codebase). `discoverMcpHandlers(module, instance)`
 * walks the instance's prototype chain — minus Object.prototype —
 * reads the metadata, and registers each decorated handler with the
 * underlying module. Handlers are bound to the instance so service
 * methods that reference `this` keep working when invoked through
 * `module.invokeTool(...)`.
 */

const TOOL_META = Symbol.for("lt:mcp:tool");
const RESOURCE_META = Symbol.for("lt:mcp:resource");

export interface McpToolDecoratorOptions {
  name: string;
  description?: string;
  inputSchema?: z.ZodType<unknown>;
  permission?: McpPermission;
}

export interface McpResourceDecoratorOptions {
  uri: string;
  description?: string;
  permission?: McpPermission;
}

export function McpTool(options: McpToolDecoratorOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    Reflect.defineMetadata(TOOL_META, options, target, propertyKey);
  };
}

export function McpResource(options: McpResourceDecoratorOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    Reflect.defineMetadata(RESOURCE_META, options, target, propertyKey);
  };
}

export function getMcpToolMetadata(
  target: object,
  propertyKey: string | symbol,
): McpToolDecoratorOptions | undefined {
  return Reflect.getMetadata(TOOL_META, target, propertyKey) as McpToolDecoratorOptions | undefined;
}

export function getMcpResourceMetadata(
  target: object,
  propertyKey: string | symbol,
): McpResourceDecoratorOptions | undefined {
  return Reflect.getMetadata(RESOURCE_META, target, propertyKey) as
    | McpResourceDecoratorOptions
    | undefined;
}

export function discoverMcpHandlers(module: McpServerModule, instance: object): void {
  const proto = Object.getPrototypeOf(instance) as object | null;
  if (!proto || proto === Object.prototype) return;

  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === "constructor") continue;
    const member = (proto as Record<string, unknown>)[key];
    if (typeof member !== "function") continue;

    const toolMeta = getMcpToolMetadata(proto, key);
    if (toolMeta) {
      const handler = (member as (input: unknown, ctx: McpContext) => Promise<unknown>).bind(
        instance,
      );
      module.registerTool({
        name: toolMeta.name,
        description: toolMeta.description,
        inputSchema: toolMeta.inputSchema,
        permission: toolMeta.permission,
        handler,
      });
      continue;
    }

    const resourceMeta = getMcpResourceMetadata(proto, key);
    if (resourceMeta) {
      const handler = (member as (uri: string, ctx: McpContext) => Promise<unknown>).bind(instance);
      module.registerResource({
        uri: resourceMeta.uri,
        description: resourceMeta.description,
        permission: resourceMeta.permission,
        handler,
      });
    }
  }
}
