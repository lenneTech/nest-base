import { Inject, Injectable, Module, type OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryModule, DiscoveryService, MetadataScanner } from "@nestjs/core";

import { PrismaService } from "../prisma/prisma.service.js";
import { AdminRolesMcpTool, type RoleCountSource } from "./admin-roles.mcp-tool.js";
import {
  discoverMcpHandlers,
  getMcpResourceMetadata,
  getMcpToolMetadata,
} from "./mcp-decorators.js";
import {
  McpResourceAlreadyRegisteredError,
  McpToolAlreadyRegisteredError,
  McpServerModule,
} from "./mcp-server.js";

export const MCP_SERVER = Symbol.for("lt:McpServer");
export const ROLE_COUNT_SOURCE = Symbol.for("lt:RoleCountSource");

/**
 * Prisma-backed `RoleCountSource` for the admin-roles MCP tool.
 * Counts non-tombstoned rows on the `Role` model (the soft-delete
 * extension is on the chain so the count excludes deleted roles).
 *
 * Iter-203 reviewer-G4 closure: every count is now scoped to the
 * caller's tenant so MCP clients cannot infer the global Role
 * inventory across tenants.
 */
@Injectable()
class PrismaRoleCountSource implements RoleCountSource {
  constructor(private readonly prisma: PrismaService) {}

  async countRoles(tenantId: string): Promise<number> {
    return this.prisma.role.count({ where: { tenantId } });
  }
}

@Injectable()
class McpDiscoveryService implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    @Inject(MCP_SERVER) private readonly mcpServer: McpServerModule,
  ) {}

  onApplicationBootstrap(): void {
    void this.scanner; // metadata read directly via Reflect in `discoverMcpHandlers`
    const providers = this.discovery.getProviders();
    for (const wrapper of providers) {
      const instance = wrapper.instance as object | null;
      if (!instance || typeof instance !== "object") continue;
      const ctor = (instance as { constructor?: unknown }).constructor;
      if (typeof ctor !== "function") continue;
      // For each method on the prototype check if it carries @McpTool / @McpResource
      const proto = Object.getPrototypeOf(instance) ?? {};
      const methodNames = Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor");
      let hasAny = false;
      for (const name of methodNames) {
        if (getMcpToolMetadata(ctor, name) || getMcpResourceMetadata(ctor, name)) {
          hasAny = true;
          break;
        }
      }
      if (hasAny) {
        // Hand off to the planner — it walks the prototype itself.
        // Narrow the catch to the two known duplicate-registration errors so
        // unexpected failures (bad metadata, programming errors) are not
        // silently swallowed (M7 fix).
        try {
          discoverMcpHandlers(this.mcpServer, instance);
        } catch (err) {
          if (
            err instanceof McpToolAlreadyRegisteredError ||
            err instanceof McpResourceAlreadyRegisteredError
          ) {
            // Duplicate registrations can happen in test environments where
            // multiple TestingModule instances share the same DI container —
            // ignore them intentionally.
          } else {
            // Re-throw anything that is not a known duplicate error so the
            // application boot fails loudly instead of silently misbehaving.
            throw err;
          }
        }
      }
    }
  }
}

/**
 * McpModule — wires the Model Context Protocol server with
 * `@McpTool()` / `@McpResource()` decorator auto-discovery via
 * `DiscoveryService`.  MCP-Auth via Better-Auth-OAuth-Provider
 * (Authorization-Code + PKCE) flows through the existing
 * `BetterAuthModule`; MCP clients use the `bearer` plugin's token
 * with the audience `mcp` to authenticate.
 */
@Module({
  imports: [DiscoveryModule],
  providers: [
    {
      // useFactory creates a fresh McpServerModule instance per DI
      // context so that parallel TestingModule bootstraps in the test
      // suite each get their own registry rather than accumulating
      // tool registrations on a shared module-scope singleton (M2 fix).
      provide: MCP_SERVER,
      useFactory: (): McpServerModule =>
        new McpServerModule({ name: "nest-server", version: "1.0.0" }),
    },
    McpDiscoveryService,
    PrismaRoleCountSource,
    {
      provide: ROLE_COUNT_SOURCE,
      useExisting: PrismaRoleCountSource,
    },
    {
      // AdminRolesMcpTool is itself a provider so DiscoveryService
      // walks its prototype + finds the `@McpTool` decorator at boot.
      // The factory binds it to the role-count source provider above.
      provide: AdminRolesMcpTool,
      useFactory: (source: RoleCountSource) => new AdminRolesMcpTool(source),
      inject: [ROLE_COUNT_SOURCE],
    },
  ],
  exports: [MCP_SERVER, AdminRolesMcpTool, ROLE_COUNT_SOURCE],
})
export class McpModule {}
