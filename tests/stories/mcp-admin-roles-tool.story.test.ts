import { describe, expect, it } from "vitest";

/**
 * Story · MCP admin-roles tool (CF.INT.04).
 *
 * The PRD's `CF.INT.04` requires a discoverable MCP tool that exposes
 * the role catalogue to MCP clients (Claude Desktop, agentic IDEs).
 * The tool must:
 *   - register via `@McpTool` so `discoverMcpHandlers` picks it up
 *     at module init
 *   - require `read Role` permission (gated by the MCP auth guard)
 *   - return the live row count as a small JSON envelope
 *   - stay side-effect-free
 *
 * The repository dependency is abstracted behind a small interface
 * (`RoleCountSource`) so the tool's behaviour is testable without
 * spinning up Prisma — the full Prisma binding ships in
 * `prisma-permission-storage.ts` and gets injected at module wiring.
 */
describe("Story · MCP admin-roles tool", () => {
  const ctx = (tenantId: string) => ({ user: { id: "u-1", tenantId } });

  it("returns the live count from the source repository for the caller's tenant", async () => {
    const { AdminRolesMcpTool } = await import("../../src/core/mcp/admin-roles.mcp-tool.js");
    let observedTenant: string | undefined;
    const tool = new AdminRolesMcpTool({
      countRoles: async (tenantId: string) => {
        observedTenant = tenantId;
        return 7;
      },
    });
    const result = await tool.rolesCount({}, ctx("tenant-A"));
    expect(result).toEqual({ count: 7 });
    expect(observedTenant).toBe("tenant-A");
  });

  it("returns 0 when the repository has no roles for the caller's tenant", async () => {
    const { AdminRolesMcpTool } = await import("../../src/core/mcp/admin-roles.mcp-tool.js");
    const tool = new AdminRolesMcpTool({
      countRoles: async () => 0,
    });
    const result = await tool.rolesCount({}, ctx("tenant-empty"));
    expect(result).toEqual({ count: 0 });
  });

  it("refuses to run without an authenticated tenant (defense-in-depth iter-203)", async () => {
    // The MCP auth guard normally pre-fills `ctx.user`. If a future
    // transport skips it, the tool refuses rather than falling through
    // to a global count.
    const { AdminRolesMcpTool } = await import("../../src/core/mcp/admin-roles.mcp-tool.js");
    const tool = new AdminRolesMcpTool({
      countRoles: async () => 999,
    });
    await expect(tool.rolesCount({}, {})).rejects.toThrow(/tenant required/);
  });

  it("scopes the count to the caller's tenant — different tenants see different counts", async () => {
    const { AdminRolesMcpTool } = await import("../../src/core/mcp/admin-roles.mcp-tool.js");
    const seen: string[] = [];
    const tool = new AdminRolesMcpTool({
      countRoles: async (tenantId: string) => {
        seen.push(tenantId);
        return tenantId === "tenant-A" ? 3 : 11;
      },
    });
    expect(await tool.rolesCount({}, ctx("tenant-A"))).toEqual({ count: 3 });
    expect(await tool.rolesCount({}, ctx("tenant-B"))).toEqual({ count: 11 });
    expect(seen).toEqual(["tenant-A", "tenant-B"]);
  });

  it("registers the tool via @McpTool with the expected metadata", async () => {
    const { AdminRolesMcpTool } = await import("../../src/core/mcp/admin-roles.mcp-tool.js");
    const { getMcpToolMetadata } = await import("../../src/core/mcp/mcp-decorators.js");
    const meta = getMcpToolMetadata(AdminRolesMcpTool.prototype, "rolesCount");
    expect(meta).toBeDefined();
    expect(meta?.name).toBe("rolesCount");
    expect(meta?.description).toMatch(/role/i);
    expect(meta?.permission).toEqual({ resource: "Role", action: "read" });
  });

  it("propagates errors from the source (does not swallow)", async () => {
    const { AdminRolesMcpTool } = await import("../../src/core/mcp/admin-roles.mcp-tool.js");
    const tool = new AdminRolesMcpTool({
      countRoles: async () => {
        throw new Error("DB unreachable");
      },
    });
    await expect(tool.rolesCount({}, ctx("tenant-A"))).rejects.toThrow(/DB unreachable/);
  });

  describe("McpModule registration (iter-73)", () => {
    it("McpModule registers AdminRolesMcpTool as a NestJS provider", async () => {
      // The DiscoveryService walks every NestJS provider for
      // `@McpTool`-decorated methods at OnApplicationBootstrap. For
      // the admin-roles tool to surface in the MCP server's tool
      // catalogue, the class itself must be present in the providers
      // array — otherwise DiscoveryService never sees it.
      const { readFileSync } = await import("node:fs");
      const moduleSrc = readFileSync("src/core/mcp/mcp.module.ts", "utf8");
      expect(moduleSrc).toContain("AdminRolesMcpTool");
      expect(moduleSrc).toContain("admin-roles.mcp-tool.js");
      // The provider exists with a useFactory wiring the role-count
      // source, otherwise the tool's constructor would receive an
      // un-DI-resolvable RoleCountSource.
      expect(moduleSrc).toMatch(/useFactory.*AdminRolesMcpTool|provide:\s*AdminRolesMcpTool/s);
    });

    it("McpModule exports a ROLE_COUNT_SOURCE token + a Prisma binding", async () => {
      const { readFileSync } = await import("node:fs");
      const moduleSrc = readFileSync("src/core/mcp/mcp.module.ts", "utf8");
      expect(moduleSrc).toContain("ROLE_COUNT_SOURCE");
      expect(moduleSrc).toContain("PrismaRoleCountSource");
      // The Prisma binding implements the RoleCountSource interface
      // by calling `prisma.role.count({ where: { tenantId } })`
      // (iter-203 reviewer-G4 closure: tenant-scoped count).
      expect(moduleSrc).toMatch(/prisma\.role\.count\(\{\s*where:\s*\{\s*tenantId\s*\}\s*\}\)/);
    });
  });
});
