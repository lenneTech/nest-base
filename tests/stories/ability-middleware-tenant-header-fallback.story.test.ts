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
    user?: { id: string; activeOrganizationId?: string | null };
    headers?: Record<string, string | string[] | undefined>;
    ability?: Ability;
  };

  function makeService(rules: Ability): PermissionService {
    return {
      abilityFor: vi.fn(async () => rules),
    } as unknown as PermissionService;
  }

  // BA's `member` table stores only active members — no status column.
  // A found row implies membership; absence implies no membership.
  function makePrismaWithRow(row: { id: string } | null): PrismaService {
    const findFirst = vi.fn(async () => row);
    return {
      member: { findFirst },
    } as unknown as PrismaService;
  }

  function makePrismaThrowing(): PrismaService {
    return {
      member: {
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

  it("uses the x-tenant-id header when req.user has no activeOrganizationId AND the user has a BA member row", async () => {
    const ability = buildAbility([{ action: "read", subject: "Example" }]);
    const service = makeService(ability);
    const prisma = makePrismaWithRow({ id: "m1" });
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", activeOrganizationId: null },
      headers: { [TENANT_HEADER]: VALID_TENANT },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

    expect(req.ability).toBe(ability);
    expect(service.abilityFor).toHaveBeenCalledWith("u1", VALID_TENANT);
    expect(next.calls).toBe(1);
  });

  it("keeps the empty-ability fallback when the header is set but the user has no member row in BA (not a member)", async () => {
    // BA's member table stores only active members — absence of a row
    // means no active membership. The resolver throws ForbiddenException;
    // the middleware swallows it and installs an empty ability. CanGuard
    // still denies because empty ability grants nothing.
    const service = makeService(buildAbility([{ action: "read", subject: "Example" }]));
    const prisma = makePrismaWithRow(null);
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", activeOrganizationId: null },
      headers: { [TENANT_HEADER]: VALID_TENANT },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

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
      user: { id: "u1", activeOrganizationId: null },
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
      member: { findFirst },
    } as unknown as PrismaService;
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", activeOrganizationId: null },
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

  it("HEADER WINS over req.user.activeOrganizationId when a BA member row exists (multi-membership UX)", async () => {
    // The resolver always validates membership via BA's member table
    // when a header is present — even if activeOrganizationId is set.
    // This closes the cross-tenant write breach vector.
    const ability = buildAbility([{ action: "read", subject: "Example" }]);
    const service = makeService(ability);
    const prisma = makePrismaWithRow({ id: "m1" });
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", activeOrganizationId: "session-org" },
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

  it("falls back to activeOrganizationId when no header is present (no DB lookup needed)", async () => {
    // When no header is present, the resolver reads
    // req.user.activeOrganizationId without consulting the member table.
    // This keeps the header-less path fast (no extra DB round-trip).
    const ability = buildAbility([{ action: "read", subject: "Example" }]);
    const service = makeService(ability);
    const findFirst = vi.fn();
    const prisma = {
      member: { findFirst },
    } as unknown as PrismaService;
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", activeOrganizationId: VALID_TENANT },
      headers: {},
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
      user: { id: "u1", activeOrganizationId: null },
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
