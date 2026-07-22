import type { NextFunction, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { AbilityMiddleware } from "../../src/core/permissions/ability.middleware.js";
import { type Ability, buildAbility } from "../../src/core/permissions/casl-ability.js";
import { PermissionService } from "../../src/core/permissions/permission.service.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Story · `AbilityMiddleware` session tenant resolution
 *
 * Tenant scope for CASL comes from `resolveRequestTenantId` (session
 * `activeOrganizationId` only). Stray `x-tenant-id` headers must not change
 * the ability tenant.
 */
describe("Story · AbilityMiddleware session tenant resolution", () => {
  const ADMIN_PATH = "/hub/admin/roles";
  const API_PATH = "/api/examples";
  const TENANT_HEADER = "x-tenant-id";
  const SESSION_TENANT = "00000000-0000-4000-8000-000000000001";
  const HEADER_TENANT = "00000000-0000-4000-8000-000000000002";

  type Req = {
    user?: { id: string; activeOrganizationId?: string | null };
    headers?: Record<string, string | string[] | undefined>;
    originalUrl?: string;
    ability?: Ability;
  };

  function makeService(rules: Ability): PermissionService {
    return {
      abilityFor: vi.fn(async () => rules),
    } as unknown as PermissionService;
  }

  function makePrisma(): PrismaService {
    return { member: { findFirst: vi.fn() } } as unknown as PrismaService;
  }

  function nextFn(): NextFunction & { calls: number; lastError?: unknown } {
    let calls = 0;
    let lastError: unknown;
    const fn = ((err?: unknown) => {
      calls += 1;
      if (err) lastError = err;
    }) as NextFunction & { calls: number; lastError?: unknown };
    Object.defineProperty(fn, "calls", { get: () => calls });
    Object.defineProperty(fn, "lastError", { get: () => lastError });
    return fn;
  }

  const res = {} as Response;

  it("builds ability from activeOrganizationId on /hub/admin/*", async () => {
    const ability = buildAbility([{ action: "read", subject: "Example" }]);
    const service = makeService(ability);
    const prisma = makePrisma();
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", activeOrganizationId: SESSION_TENANT },
      headers: {},
      originalUrl: ADMIN_PATH,
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

    expect(req.ability).toBe(ability);
    expect(service.abilityFor).toHaveBeenCalledWith("u1", SESSION_TENANT, { scopes: undefined });
    expect(next.calls).toBe(1);
  });

  it("ignores x-tenant-id on /hub/admin/* when session org is set", async () => {
    const ability = buildAbility([{ action: "read", subject: "Example" }]);
    const service = makeService(ability);
    const prisma = makePrisma();
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", activeOrganizationId: SESSION_TENANT },
      headers: { [TENANT_HEADER]: HEADER_TENANT },
      originalUrl: ADMIN_PATH,
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

    expect(service.abilityFor).toHaveBeenCalledWith("u1", SESSION_TENANT, { scopes: undefined });
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to empty ability when session has no active org", async () => {
    const service = makeService(buildAbility([{ action: "read", subject: "Example" }]));
    const prisma = makePrisma();
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", activeOrganizationId: null },
      headers: { [TENANT_HEADER]: HEADER_TENANT },
      originalUrl: ADMIN_PATH,
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

    expect(req.ability).toBeDefined();
    expect(req.ability!.can("read", "Example")).toBe(false);
    expect(service.abilityFor).not.toHaveBeenCalled();
    expect(next.calls).toBe(1);
  });

  it("ignores x-tenant-id on /api/* and uses activeOrganizationId", async () => {
    const ability = buildAbility([{ action: "read", subject: "Example" }]);
    const service = makeService(ability);
    const prisma = makePrisma();
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", activeOrganizationId: SESSION_TENANT },
      headers: { [TENANT_HEADER]: HEADER_TENANT },
      originalUrl: API_PATH,
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

    expect(service.abilityFor).toHaveBeenCalledWith("u1", SESSION_TENANT, { scopes: undefined });
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });
});
