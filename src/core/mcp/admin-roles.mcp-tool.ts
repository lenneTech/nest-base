import { z } from "zod";

import { McpTool } from "./mcp-decorators.js";
import type { McpContext } from "./mcp-server.js";

/**
 * AdminRolesMcpTool — MCP tool exposing the role catalogue (CF.INT.04).
 *
 * Lets MCP clients (Claude Desktop, agentic IDEs) read the live row
 * count of permission Roles. Side-effect-free; gated by the
 * `read Role` ability via the MCP auth guard. The Administrator
 * role grants this through CASL's `manage all`; an authenticated
 * session without the role gets a 403 problem-detail response.
 *
 * Why a small read-only tool: it exercises the real Prisma + audit
 * + soft-delete extension stack without producing bulky output that
 * would bump against the SDK's ~100KB envelope cap. Also serves as
 * a "is the permission engine alive?" probe for agents.
 *
 * The Role-count source is an interface so the tool stays testable
 * without spinning up Prisma. The full binding lives in
 * `prisma-permission-storage.ts`.
 *
 * Ported from nest-base-alternative — 2026-05-04 fusion iter-39
 */

export interface RoleCountSource {
  // Iter-203 reviewer-G4 closure: counts must be tenant-scoped.
  // Previously the count was global which let an MCP client see how
  // many Roles the entire deployment carries (information leak).
  countRoles(tenantId: string): Promise<number>;
}

export class AdminRolesMcpTool {
  constructor(private readonly source: RoleCountSource) {}

  @McpTool({
    name: "rolesCount",
    description:
      "Returns the live count of permission Roles for the authenticated user's tenant. Side-effect-free; requires `read Role` ability, which the Administrator role grants.",
    inputSchema: z.object({}),
    permission: { resource: "Role", action: "read" },
  })
  async rolesCount(_input: unknown, ctx: McpContext): Promise<{ count: number }> {
    if (!ctx.user || !ctx.user.tenantId) {
      // The MCP auth guard normally pre-fills `ctx.user` from the
      // bearer-plugin's session — but a misconfigured transport (or
      // a future code path that skips the guard) would leave it
      // undefined. Refusing here is safer than falling through to a
      // global count.
      throw new Error("rolesCount: authenticated tenant required");
    }
    const count = await this.source.countRoles(ctx.user.tenantId);
    return { count };
  }
}
