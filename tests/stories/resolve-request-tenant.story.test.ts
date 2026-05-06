import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { resolveRequestTenantId } from "../../src/core/multi-tenancy/resolve-request-tenant.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Story · `resolveRequestTenantId(req, prisma)`
 *
 * Single source of truth for "what tenant id does this request operate
 * in" — both `TenantInterceptor` (RLS / `runWithTenant`) and
 * `AbilityMiddleware` (CASL ability) must agree on the answer.
 *
 * Cross-tenant write breach (LLM-test 2026-05-03 #20:21): when the auth
 * layer trusted `req.user.tenantId` and the data layer trusted the
 * `x-tenant-id` header, Bob (primary tenant `bobTenant`) could
 * `POST /examples` with `x-tenant-id: <aliceTenantId>` and the row
 * landed in Alice's tenant — RLS happily set `app.tenant_id =
 * aliceTenantId` while CanGuard built the ability for `bobTenant`
 * (which has `manage Example`, granting create on the type check).
 *
 * The resolver closes the gap:
 *   - Header present + ACTIVE membership → that tenant id (becomes the
 *     authoritative id for BOTH layers).
 *   - Header present + no/non-ACTIVE membership → `ForbiddenException`
 *     (NEVER fall back silently — that's the breach).
 *   - Header malformed → `BadRequestException` (don't echo the value
 *     into logs / DB queries; same hardening as `parseTenantHeader`).
 *   - No header → `req.user.tenantId` (the primary / "session" tenant).
 *   - No header + no session tenant → `null` (caller decides; usually
 *     means "anonymous / no tenant scope yet").
 */
describe("Story · resolveRequestTenantId", () => {
  const VALID_TENANT_A = "00000000-0000-4000-8000-000000000001";
  const VALID_TENANT_B = "00000000-0000-4000-8000-000000000002";

  type Req = {
    user?: { id: string; tenantId: string | null; activeOrganizationId?: string | null };
    headers?: Record<string, string | string[] | undefined>;
  };

  function makePrismaWithRow(row: { id: string; status: string } | null): PrismaService {
    const findFirst = vi.fn(async (input: { where?: Record<string, unknown> }) => {
      if (!row) return null;
      const where = input?.where ?? {};
      // Mirror real Prisma semantics — the WHERE is applied in DB.
      if (where.status !== undefined && row.status !== where.status) return null;
      return row;
    });
    return { tenantMember: { findFirst } } as unknown as PrismaService;
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

  it("returns null when no header is set AND req.user is missing (anonymous, no tenant scope)", async () => {
    const prisma = makePrismaWithRow(null);
    const req: Req = { headers: {} };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBeNull();
  });

  it("returns null when no header is set AND req.user.tenantId is null (signed-up, no tenant yet)", async () => {
    const prisma = makePrismaWithRow(null);
    const req: Req = { user: { id: "u1", tenantId: null }, headers: {} };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBeNull();
  });

  it("returns the session tenant when no header is set AND req.user.tenantId is non-null", async () => {
    const prisma = makePrismaWithRow(null);
    const req: Req = { user: { id: "u1", tenantId: VALID_TENANT_A }, headers: {} };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
    // No header → no DB lookup needed; this also keeps the hot path fast.
    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
  });

  it("short-circuits the membership lookup when the header just echoes req.user.tenantId", async () => {
    // The `createTenantWithMember` invariant guarantees an ACTIVE
    // membership when `User.tenantId` is non-null and matches — the
    // DB round-trip would just confirm what we know. Skipping it
    // keeps the hot path fast AND keeps existing tests green that
    // pin User.tenantId without seeding a TenantMember row (the
    // membership row is a transitive obligation of `signUp` flow).
    const findFirst = vi.fn(async () => null);
    const prisma = { tenantMember: { findFirst } } as unknown as PrismaService;
    const req: Req = {
      user: { id: "u1", tenantId: VALID_TENANT_A },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("returns the header tenant when the user has an ACTIVE membership for it", async () => {
    const prisma = makePrismaWithRow({ id: "m1", status: "ACTIVE" });
    const req: Req = {
      user: { id: "u1", tenantId: VALID_TENANT_B },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
    // Even with a non-null session tenant, the explicit header wins
    // when membership is ACTIVE — that's the multi-membership UX.
    expect(prisma.tenantMember.findFirst).toHaveBeenCalledWith({
      where: { userId: "u1", tenantId: VALID_TENANT_A, status: "ACTIVE" },
      select: { id: true },
    });
  });

  it("throws ForbiddenException when the header tenant has only an INVITED membership (not ACTIVE)", async () => {
    const prisma = makePrismaWithRow({ id: "m1", status: "INVITED" });
    const req: Req = {
      user: { id: "u1", tenantId: VALID_TENANT_B },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    await expect(resolveRequestTenantId(req as never, prisma)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("throws ForbiddenException when the header tenant has only a SUSPENDED membership", async () => {
    const prisma = makePrismaWithRow({ id: "m1", status: "SUSPENDED" });
    const req: Req = {
      user: { id: "u1", tenantId: VALID_TENANT_B },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    await expect(resolveRequestTenantId(req as never, prisma)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("throws ForbiddenException when the header tenant has NO membership row at all (cross-tenant breach)", async () => {
    const prisma = makePrismaWithRow(null);
    const req: Req = {
      user: { id: "u1", tenantId: VALID_TENANT_B },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    // BEFORE this fix the resolver returned `VALID_TENANT_B` (the
    // session tenant) — a silent fallback that let the breach through.
    // AFTER: header-without-membership is hard-403, never silent.
    await expect(resolveRequestTenantId(req as never, prisma)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("throws BadRequestException when the header is a malformed UUID", async () => {
    const prisma = makePrismaWithRow(null);
    const req: Req = {
      user: { id: "u1", tenantId: VALID_TENANT_A },
      headers: { "x-tenant-id": "not-a-uuid" },
    };
    await expect(resolveRequestTenantId(req as never, prisma)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Hardening: don't even consult the DB on malformed input — the
    // value would otherwise round-trip into a Prisma WHERE clause and
    // potentially log-leak a CRLF-poisoned header.
    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
  });

  it("throws when the membership lookup fails (do NOT fail open to a foreign tenant)", async () => {
    const prisma = makePrismaThrowing();
    const req: Req = {
      user: { id: "u1", tenantId: VALID_TENANT_B },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    // Either re-throw the storage error or wrap it — but never silently
    // fall back to the session tenant. The middleware decides how to
    // surface this (it still chooses fail-closed = empty ability).
    await expect(resolveRequestTenantId(req as never, prisma)).rejects.toThrow();
  });

  it("normalises mixed-case UUIDs to lowercase (consistency with parseTenantHeader)", async () => {
    const prisma = makePrismaWithRow({ id: "m1", status: "ACTIVE" });
    const req: Req = {
      user: { id: "u1", tenantId: null },
      // Same UUID as VALID_TENANT_A but uppercase.
      headers: { "x-tenant-id": VALID_TENANT_A.toUpperCase() },
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
  });

  it("picks the first value when the header arrives as an array (Express edge case)", async () => {
    const prisma = makePrismaWithRow({ id: "m1", status: "ACTIVE" });
    const req: Req = {
      user: { id: "u1", tenantId: null },
      headers: { "x-tenant-id": [VALID_TENANT_A, "second"] },
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
  });

  it("does not touch DB when there is no req.user (anonymous request with header — caller decides)", async () => {
    const prisma = makePrismaWithRow({ id: "m1", status: "ACTIVE" });
    const req: Req = { headers: { "x-tenant-id": VALID_TENANT_A } };
    // Anonymous → can't have an ACTIVE membership. The resolver
    // returns null (no auth identity to attach the tenant to); the
    // caller (interceptor for unauth requests on exempt paths) decides
    // what null means in its context.
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBeNull();
    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
  });

  // Issue #103 — session.activeOrganizationId fallback
  it("falls back to session.activeOrganizationId when no header is present (issue #103)", async () => {
    // When the caller has authenticated and the Better-Auth organization
    // plugin wrote an `activeOrganizationId` to the session, that value
    // should serve as the tenant id for requests that arrive without an
    // explicit `x-tenant-id` header. This allows mobile / web clients
    // that set the active org once (via /api/auth/organization/set-active)
    // to omit the header on every subsequent request.
    const prisma = makePrismaWithRow(null);
    const req: Req = {
      user: { id: "u1", tenantId: null, activeOrganizationId: VALID_TENANT_A },
      headers: {},
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
    // No header → no DB lookup needed (same short-circuit as the tenantId path).
    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
  });

  it("prefers header over session.activeOrganizationId when both are present (header wins)", async () => {
    // The `x-tenant-id` header is the explicit per-request override.
    // A client that wants to act in a different tenant than the session
    // default can always supply the header — the header always wins.
    const prisma = makePrismaWithRow({ id: "m1", status: "ACTIVE" });
    const req: Req = {
      user: { id: "u1", tenantId: null, activeOrganizationId: VALID_TENANT_B },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
  });

  it("prefers session.activeOrganizationId over req.user.tenantId when no header is set", async () => {
    // When the user has both a primary tenant (tenantId) and an active
    // organization in their session (activeOrganizationId), the session
    // active organization wins — it is the more specific, user-selected
    // context. The primary tenantId remains as the ultimate fallback
    // when activeOrganizationId is absent.
    const prisma = makePrismaWithRow(null);
    const req: Req = {
      user: { id: "u1", tenantId: VALID_TENANT_B, activeOrganizationId: VALID_TENANT_A },
      headers: {},
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
  });

  it("falls back to req.user.tenantId when activeOrganizationId is null and no header is set", async () => {
    // Preserves existing behaviour: users without an active organization
    // still get their primary tenant as the resolved tenant id.
    const prisma = makePrismaWithRow(null);
    const req: Req = {
      user: { id: "u1", tenantId: VALID_TENANT_B, activeOrganizationId: null },
      headers: {},
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_B);
  });
});
