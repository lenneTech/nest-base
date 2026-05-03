import type { NextFunction, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { AbilityMiddleware } from "../../src/core/permissions/ability.middleware.js";
import { type Ability, buildAbility } from "../../src/core/permissions/casl-ability.js";
import { PermissionService } from "../../src/core/permissions/permission.service.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Story · `AbilityMiddleware` x-tenant-id resolution
 *
 * History: this file was originally written to pin down the
 * "header-fallback when User.tenantId is null" behaviour from PR #63.
 * That logic now lives in the unified `resolveRequestTenantId` helper
 * — the SAME helper `TenantInterceptor` uses, so the auth tenant
 * (CASL ability) and the data tenant (RLS context) can no longer
 * disagree.
 *
 * Layered responsibility (closes cross-tenant write breach,
 * LLM-test 2026-05-03 #20:21):
 *   - The HARD throw on header-without-membership belongs in
 *     `TenantInterceptor` — that's the layer that gates RLS, so a 403
 *     there blocks the write before the controller runs.
 *   - This middleware installs `req.ability`. On resolver failure it
 *     falls back to an EMPTY ability (not a hard 403) so non-`@Can()`
 *     routes that scope by `req.user.id` (e.g. `/me/devices`) don't
 *     spuriously 403 when a client forwards a stray tenant header.
 *     `@Can()`-gated routes still deny via `CanGuard` because empty
 *     ability grants nothing — so the breach stays closed.
 *   - HEADER WINS over `req.user.tenantId` when the user has an ACTIVE
 *     membership for the header tenant — that's the multi-membership
 *     UX. Without ACTIVE membership: empty ability (resolver throws,
 *     middleware swallows the signal at this layer).
 */
describe("Story · AbilityMiddleware x-tenant-id resolution", () => {
  const TENANT_HEADER = "x-tenant-id";
  const VALID_TENANT = "00000000-0000-4000-8000-000000000001";
  const OTHER_TENANT = "00000000-0000-4000-8000-000000000002";

  type Req = {
    user?: { id: string; tenantId: string | null };
    headers?: Record<string, string | string[] | undefined>;
    ability?: Ability;
  };

  function makeService(rules: Ability): PermissionService {
    return {
      abilityFor: vi.fn(async () => rules),
    } as unknown as PermissionService;
  }

  function makePrismaWithRow(row: { id: string; status: string } | null): PrismaService {
    const findFirst = vi.fn(async (input: { where?: Record<string, unknown> }) => {
      if (!row) return null;
      const where = input?.where ?? {};
      if (where.status !== undefined && row.status !== where.status) return null;
      return row;
    });
    return {
      tenantMember: { findFirst },
    } as unknown as PrismaService;
  }

  function makePrismaThrowing(): PrismaService {
    return {
      tenantMember: {
        findFirst: vi.fn(async () => {
          throw new Error("db unavailable");
        }),
      },
    } as unknown as PrismaService;
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

  it("uses the x-tenant-id header when req.user.tenantId is null AND the user has an ACTIVE membership", async () => {
    const ability = buildAbility([{ action: "read", subject: "Example" }]);
    const service = makeService(ability);
    const prisma = makePrismaWithRow({ id: "m1", status: "ACTIVE" });
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", tenantId: null },
      headers: { [TENANT_HEADER]: VALID_TENANT },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

    expect(req.ability).toBe(ability);
    expect(service.abilityFor).toHaveBeenCalledWith("u1", VALID_TENANT);
    expect(next.calls).toBe(1);
  });

  it("keeps the empty-ability fallback when the header is set but membership is INVITED (not ACTIVE)", async () => {
    const service = makeService(buildAbility([{ action: "read", subject: "Example" }]));
    const prisma = makePrismaWithRow({ id: "m1", status: "INVITED" });
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", tenantId: null },
      headers: { [TENANT_HEADER]: VALID_TENANT },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

    // Resolver throws ForbiddenException; middleware swallows the
    // signal and installs an empty ability. CanGuard still denies
    // because empty ability grants nothing — and the interceptor
    // raises the hard 403 separately at the RLS layer.
    expect(req.ability).toBeDefined();
    expect(req.ability!.can("read", "Example")).toBe(false);
    expect(service.abilityFor).not.toHaveBeenCalled();
    expect(next.calls).toBe(1);
    expect(next.lastError).toBeUndefined();
  });

  it("keeps the empty-ability fallback when the header points at a tenant the user is NOT a member of", async () => {
    const service = makeService(buildAbility([{ action: "read", subject: "Example" }]));
    const prisma = makePrismaWithRow(null);
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", tenantId: null },
      headers: { [TENANT_HEADER]: OTHER_TENANT },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

    expect(req.ability).toBeDefined();
    expect(req.ability!.can("read", "Example")).toBe(false);
    expect(service.abilityFor).not.toHaveBeenCalled();
    expect(next.calls).toBe(1);
    expect(next.lastError).toBeUndefined();
  });

  it("rejects a non-UUID x-tenant-id header without consulting the membership table (fail-closed)", async () => {
    const service = makeService(buildAbility([{ action: "read", subject: "Example" }]));
    const findFirst = vi.fn(async () => null);
    const prisma = {
      tenantMember: { findFirst },
    } as unknown as PrismaService;
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", tenantId: null },
      headers: { [TENANT_HEADER]: "not-a-uuid" },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

    expect(req.ability).toBeDefined();
    expect(req.ability!.can("read", "Example")).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
    expect(service.abilityFor).not.toHaveBeenCalled();
    expect(next.calls).toBe(1);
    // The interceptor surfaces 400 on this input; the middleware
    // empty-abilities so non-Can routes don't fail spuriously.
    expect(next.lastError).toBeUndefined();
  });

  it("HEADER WINS over req.user.tenantId when ACTIVE membership exists (multi-membership UX)", async () => {
    // CHANGED from the previous "header is fallback-only" semantics:
    // a non-null `req.user.tenantId` no longer suppresses the header
    // lookup. The ACTIVE-membership check still runs — the breach was
    // specifically the case where the OLD code skipped the membership
    // check entirely; now the resolver always validates.
    const ability = buildAbility([{ action: "read", subject: "Example" }]);
    const service = makeService(ability);
    const prisma = makePrismaWithRow({ id: "m1", status: "ACTIVE" });
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", tenantId: "session-tenant" },
      headers: { [TENANT_HEADER]: OTHER_TENANT },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

    expect(req.ability).toBe(ability);
    // Build the ability for the HEADER tenant, not the session tenant.
    expect(service.abilityFor).toHaveBeenCalledWith("u1", OTHER_TENANT);
    expect(next.calls).toBe(1);
    expect(next.lastError).toBeUndefined();
  });

  it("does NOT consult the membership table when the header just echoes req.user.tenantId (DB short-circuit)", async () => {
    // When header == session tenant, the `createTenantWithMember`
    // invariant guarantees an ACTIVE membership exists — the lookup
    // would round-trip just to confirm what we already know. Skipping
    // it keeps the hot path fast AND keeps existing tests that set
    // `User.tenantId` without creating a `TenantMember` row green.
    const ability = buildAbility([{ action: "read", subject: "Example" }]);
    const service = makeService(ability);
    const findFirst = vi.fn();
    const prisma = {
      tenantMember: { findFirst },
    } as unknown as PrismaService;
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", tenantId: VALID_TENANT },
      headers: { [TENANT_HEADER]: VALID_TENANT },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

    expect(req.ability).toBe(ability);
    expect(service.abilityFor).toHaveBeenCalledWith("u1", VALID_TENANT);
    expect(findFirst).not.toHaveBeenCalled();
    expect(next.calls).toBe(1);
  });

  it("falls back to empty ability when storage lookup throws (fail-closed, no 500)", async () => {
    const service = makeService(buildAbility([{ action: "read", subject: "Example" }]));
    const prisma = makePrismaThrowing();
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", tenantId: null },
      headers: { [TENANT_HEADER]: VALID_TENANT },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

    expect(req.ability).toBeDefined();
    expect(req.ability!.can("read", "Example")).toBe(false);
    expect(next.calls).toBe(1);
    expect(next.lastError).toBeUndefined();
  });
});
