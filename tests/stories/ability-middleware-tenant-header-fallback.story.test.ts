import type { NextFunction, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { AbilityMiddleware } from "../../src/core/permissions/ability.middleware.js";
import { type Ability, buildAbility } from "../../src/core/permissions/casl-ability.js";
import { PermissionService } from "../../src/core/permissions/permission.service.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Story · `AbilityMiddleware` x-tenant-id header fallback
 *
 * Friction-log blocker (LLM-test 2026-05-03 #4): when `req.user.tenantId`
 * is null but the user has an ACTIVE TenantMember row, the middleware
 * MUST fall back to the `x-tenant-id` request header to compute the
 * ability. Without this fallback, two surfaces stay broken:
 *
 *   1. Users created BEFORE the storage-side fix still have
 *      `tenantId === null` in `users` even after they have memberships.
 *   2. Users with multiple memberships need a way to pick which
 *      tenant context to act in for a given request.
 *
 * Security guarantee: the middleware MUST verify the requested tenant
 * has an ACTIVE TenantMember row for `req.user.id` BEFORE trusting
 * the header. Skipping the check would let any signed-in user
 * impersonate any tenant by setting the header — privilege escalation.
 */
describe("Story · AbilityMiddleware x-tenant-id fallback", () => {
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

  /**
   * Minimal Prisma stand-in. Only `tenantMember.findFirst` is used by
   * the middleware fallback, but typed as the full PrismaService for
   * the constructor. The stub honours the `where.status` filter so
   * tests can exercise the "INVITED row exists but is filtered out"
   * scenario (matches real Prisma semantics — the WHERE clause is
   * applied server-side).
   */
  function makePrismaWithRow(
    row: { id: string; status: string } | null,
  ): PrismaService {
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

  function nextFn(): NextFunction & { calls: number } {
    let calls = 0;
    const fn = ((..._args: unknown[]) => {
      calls += 1;
    }) as NextFunction & { calls: number };
    Object.defineProperty(fn, "calls", { get: () => calls });
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

    expect(req.ability).toBeDefined();
    // Empty-ability fallback denies everything.
    expect(req.ability!.can("read", "Example")).toBe(false);
    expect(service.abilityFor).not.toHaveBeenCalled();
    expect(next.calls).toBe(1);
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
  });

  it("does NOT consult the header when req.user.tenantId is already set (header is fallback-only)", async () => {
    const ability = buildAbility([{ action: "read", subject: "Example" }]);
    const service = makeService(ability);
    const findFirst = vi.fn();
    const prisma = {
      tenantMember: { findFirst },
    } as unknown as PrismaService;
    const mw = new AbilityMiddleware(service, prisma);
    const req: Req = {
      user: { id: "u1", tenantId: "session-tenant" },
      headers: { [TENANT_HEADER]: OTHER_TENANT },
    };
    const next = nextFn();
    await mw.use(req as never, res, next);

    expect(req.ability).toBe(ability);
    expect(service.abilityFor).toHaveBeenCalledWith("u1", "session-tenant");
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
  });
});
