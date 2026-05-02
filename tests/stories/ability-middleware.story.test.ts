import type { NextFunction, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { AbilityMiddleware } from "../../src/core/permissions/ability.middleware.js";
import { type Ability, buildAbility } from "../../src/core/permissions/casl-ability.js";
import { PermissionService } from "../../src/core/permissions/permission.service.js";

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
    const mw = new AbilityMiddleware(service);
    const req: { user?: { id: string; tenantId: string | null }; ability?: Ability } = {
      user: { id: "u1", tenantId: "t1" },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);
    expect(req.ability).toBe(ability);
    expect(next.calls).toBe(1);
    expect(service.abilityFor).toHaveBeenCalledWith("u1", "t1");
  });

  it("does not overwrite a pre-seeded ability (TestAbilityMiddleware contract)", async () => {
    const seeded = buildAbility([{ action: "manage", subject: "all" }]);
    const service = makeService(buildAbility([]));
    const mw = new AbilityMiddleware(service);
    const req: { user?: { id: string; tenantId: string | null }; ability?: Ability } = {
      user: { id: "u1", tenantId: "t1" },
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
    const mw = new AbilityMiddleware(service);
    const req: { user?: { id: string; tenantId: string | null }; ability?: Ability } = {};
    const next = nextFn();
    await mw.use(req as never, res, next);
    expect(req.ability).toBeDefined();
    expect(req.ability!.can("read", "Anything")).toBe(false);
    expect(service.abilityFor).not.toHaveBeenCalled();
    expect(next.calls).toBe(1);
  });

  it("attaches an empty ability when the user has no tenantId", async () => {
    const service = makeService(buildAbility([]));
    const mw = new AbilityMiddleware(service);
    const req: { user?: { id: string; tenantId: string | null }; ability?: Ability } = {
      user: { id: "u1", tenantId: null },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);
    expect(req.ability).toBeDefined();
    expect(service.abilityFor).not.toHaveBeenCalled();
    expect(next.calls).toBe(1);
  });

  it("falls back to an empty ability when the storage layer throws (fail-closed)", async () => {
    const service = {
      abilityFor: vi.fn(async () => {
        throw new Error("db unavailable");
      }),
    } as unknown as PermissionService;
    const mw = new AbilityMiddleware(service);
    const req: { user?: { id: string; tenantId: string | null }; ability?: Ability } = {
      user: { id: "u1", tenantId: "t1" },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);
    expect(req.ability).toBeDefined();
    expect(req.ability!.can("read", "Example")).toBe(false);
    expect(next.calls).toBe(1);
  });
});
