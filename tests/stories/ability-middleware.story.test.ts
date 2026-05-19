import type { NextFunction, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { AbilityMiddleware } from "../../src/core/permissions/ability.middleware.js";
import { type Ability, buildAbility } from "../../src/core/permissions/casl-ability.js";
import { PermissionService } from "../../src/core/permissions/permission.service.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Prisma stand-in for cases where the middleware does NOT need to
 * consult the membership table — `findFirst` is always-null fallback.
 * The middleware-tenant-header-fallback story covers the path where
 * the lookup actually matters.
 *
 * After issue #118, the membership table is BA's `member`
 * (not the old `tenantMember`). The no-header path never calls
 * findFirst, so this stub is never actually invoked in these tests.
 */
function prismaStub(): PrismaService {
  return {
    member: { findFirst: vi.fn(async () => null) },
  } as unknown as PrismaService;
}

/**
 * Story · `AbilityMiddleware` (closes blocker — replaces interceptor
 * for ability attachment).
 *
 * NestJS runs middleware BEFORE guards. The previous design attached
 * the ability in an interceptor (which runs AFTER guards), so
 * `CanGuard` always saw `undefined` and 403'd every authenticated
 * request. This middleware closes that gap by resolving the ability
 * during the middleware phase.
 */
describe("Story · AbilityMiddleware", () => {
  function makeService(rules: Ability): PermissionService {
    return {
      abilityFor: vi.fn(async () => rules),
    } as unknown as PermissionService;
  }

  function nextFn(): NextFunction & { calls: number } {
    let calls = 0;
    const fn = ((..._args: unknown[]) => {
      calls += 1;
    }) as NextFunction & { calls: number };
    Object.defineProperty(fn, "calls", {
      get: () => calls,
    });
    return fn;
  }

  const res = {} as Response;

  it("attaches the resolved ability for authenticated requests", async () => {
    const ability = buildAbility([{ action: "read", subject: "Example" }]);
    const service = makeService(ability);
    const mw = new AbilityMiddleware(service, prismaStub());
    // After issue #118, the resolver reads activeOrganizationId (not tenantId).
    const req: { user?: { id: string; activeOrganizationId: string | null }; ability?: Ability } = {
      user: { id: "u1", activeOrganizationId: "t1" },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);
    expect(req.ability).toBe(ability);
    expect(next.calls).toBe(1);
    expect(service.abilityFor).toHaveBeenCalledWith("u1", "t1", { scopes: undefined });
  });

  it("does not overwrite a pre-seeded ability (TestAbilityMiddleware contract)", async () => {
    const seeded = buildAbility([{ action: "manage", subject: "all" }]);
    const service = makeService(buildAbility([]));
    const mw = new AbilityMiddleware(service, prismaStub());
    const req: { user?: { id: string; activeOrganizationId: string | null }; ability?: Ability } = {
      user: { id: "u1", activeOrganizationId: "t1" },
      ability: seeded,
    };
    const next = nextFn();
    await mw.use(req as never, res, next);
    expect(req.ability).toBe(seeded);
    expect(service.abilityFor).not.toHaveBeenCalled();
    expect(next.calls).toBe(1);
  });

  it("attaches an empty ability when there is no user", async () => {
    const service = makeService(buildAbility([]));
    const mw = new AbilityMiddleware(service, prismaStub());
    const req: { user?: { id: string; activeOrganizationId: string | null }; ability?: Ability } =
      {};
    const next = nextFn();
    await mw.use(req as never, res, next);
    expect(req.ability).toBeDefined();
    expect(req.ability!.can("read", "Anything")).toBe(false);
    expect(service.abilityFor).not.toHaveBeenCalled();
    expect(next.calls).toBe(1);
  });

  it("attaches an empty ability when the user has no activeOrganizationId", async () => {
    // After issue #118, the resolver reads activeOrganizationId from the BA
    // session (not the old User.tenantId FK). A null activeOrganizationId
    // means no tenant scope → empty ability.
    const service = makeService(buildAbility([]));
    const mw = new AbilityMiddleware(service, prismaStub());
    const req: { user?: { id: string; activeOrganizationId: string | null }; ability?: Ability } = {
      user: { id: "u1", activeOrganizationId: null },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);
    expect(req.ability).toBeDefined();
    expect(service.abilityFor).not.toHaveBeenCalled();
    expect(next.calls).toBe(1);
  });

  it("builds ability on tenant-exempt /hub/* paths using the operator's default org", async () => {
    const ability = buildAbility([{ action: "read", subject: "DevHub" }]);
    const service = makeService(ability);
    const findFirst = vi.fn(async () => ({ organizationId: "t1" }));
    const prisma = { member: { findFirst } } as unknown as PrismaService;
    const mw = new AbilityMiddleware(service, prisma);
    const req: {
      user?: { id: string; activeOrganizationId: string | null };
      ability?: Ability;
      originalUrl?: string;
    } = {
      user: { id: "u1", activeOrganizationId: null },
      originalUrl: "/hub/portal-access.json",
    };
    const next = nextFn();
    await mw.use(req as never, res, next);
    expect(req.ability).toBe(ability);
    expect(service.abilityFor).toHaveBeenCalledWith("u1", "t1", { scopes: undefined });
    expect(next.calls).toBe(1);
  });

  it("falls back to an empty ability when the storage layer throws (fail-closed)", async () => {
    const service = {
      abilityFor: vi.fn(async () => {
        throw new Error("db unavailable");
      }),
    } as unknown as PermissionService;
    const mw = new AbilityMiddleware(service, prismaStub());
    const req: { user?: { id: string; activeOrganizationId: string | null }; ability?: Ability } = {
      user: { id: "u1", activeOrganizationId: "t1" },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);
    expect(req.ability).toBeDefined();
    expect(req.ability!.can("read", "Example")).toBe(false);
    expect(next.calls).toBe(1);
  });
});
