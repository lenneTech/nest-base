import { Injectable, Module, type OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryModule, DiscoveryService, MetadataScanner } from "@nestjs/core";

import {
  discoverMcpHandlers,
  getMcpResourceMetadata,
  getMcpToolMetadata,
} from "./mcp-decorators.js";
import { McpServerModule as McpServer } from "./mcp-server.js";

export const MCP_SERVER = Symbol.for("lt:McpServer");

@Injectable()
class McpDiscoveryService implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
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
        try {
          discoverMcpHandlers(server, instance);
        } catch {
          /* duplicate registration — ignore */
        }
      }
    }
  }
}

const server = new McpServer({ name: "nest-server", version: "1.0.0" });

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
  providers: [{ provide: MCP_SERVER, useValue: server }, McpDiscoveryService],
  exports: [MCP_SERVER],
})
export class McpModule {}
