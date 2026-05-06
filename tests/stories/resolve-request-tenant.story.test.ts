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
 * `x-tenant-id` header, Bob could `POST /examples` with
 * `x-tenant-id: <aliceTenantId>` and the row landed in Alice's tenant.
 *
 * The resolver closes the gap (post issue #118 — BA Organizations):
 *   - Header present + `member` row found → return that tenant id.
 *   - Header present + no `member` row → `ForbiddenException`.
 *   - Header malformed → `BadRequestException`.
 *   - No header → `req.user.activeOrganizationId` (set by BA org plugin).
 *   - No header + no activeOrganizationId → `null` (caller decides).
 *
 * Since BA's `member` table stores only active members (invitations live
 * in `invitation`), the presence of a `member` row is the ACTIVE check.
 */
describe("Story · resolveRequestTenantId", () => {
  const VALID_TENANT_A = "00000000-0000-4000-8000-000000000001";
  const VALID_TENANT_B = "00000000-0000-4000-8000-000000000002";

  type Req = {
    user?: { id: string; activeOrganizationId?: string | null };
    headers?: Record<string, string | string[] | undefined>;
  };

  // BA member table: presence of row = active membership; absence = no access.
  function makePrismaWithRow(row: { id: string } | null): PrismaService {
    const findFirst = vi.fn(async () => row);
    return { member: { findFirst } } as unknown as PrismaService;
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

  it("returns null when no header is set AND req.user is missing (anonymous, no tenant scope)", async () => {
    const prisma = makePrismaWithRow(null);
    const req: Req = { headers: {} };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBeNull();
  });

  it("returns null when no header is set AND req.user has no activeOrganizationId", async () => {
    const prisma = makePrismaWithRow(null);
    const req: Req = { user: { id: "u1", activeOrganizationId: null }, headers: {} };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBeNull();
  });

  it("returns session.activeOrganizationId when no header is set and it is non-null", async () => {
    const prisma = makePrismaWithRow(null);
    const req: Req = { user: { id: "u1", activeOrganizationId: VALID_TENANT_A }, headers: {} };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
    // No header → no DB lookup needed.
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it("returns the header tenant when the user has a member row for it", async () => {
    const prisma = makePrismaWithRow({ id: "m1" });
    const req: Req = {
      user: { id: "u1", activeOrganizationId: VALID_TENANT_B },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
    expect(prisma.member.findFirst).toHaveBeenCalledWith({
      where: { userId: "u1", organizationId: VALID_TENANT_A },
      select: { id: true },
    });
  });

  it("throws ForbiddenException when no member row exists for the header tenant (cross-tenant breach)", async () => {
    const prisma = makePrismaWithRow(null);
    const req: Req = {
      user: { id: "u1", activeOrganizationId: VALID_TENANT_B },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    // BEFORE this fix a silent fallback let the breach through.
    // AFTER: header-without-membership is hard-403.
    await expect(resolveRequestTenantId(req as never, prisma)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("throws BadRequestException when the header is a malformed UUID", async () => {
    const prisma = makePrismaWithRow(null);
    const req: Req = {
      user: { id: "u1", activeOrganizationId: VALID_TENANT_A },
      headers: { "x-tenant-id": "not-a-uuid" },
    };
    await expect(resolveRequestTenantId(req as never, prisma)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Don't consult DB on malformed input — prevents log-poisoning via CRLF.
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it("throws when the membership lookup fails (do NOT fail open to a foreign tenant)", async () => {
    const prisma = makePrismaThrowing();
    const req: Req = {
      user: { id: "u1", activeOrganizationId: VALID_TENANT_B },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    await expect(resolveRequestTenantId(req as never, prisma)).rejects.toThrow();
  });

  it("normalises mixed-case UUIDs to lowercase (consistency with parseTenantHeader)", async () => {
    const prisma = makePrismaWithRow({ id: "m1" });
    const req: Req = {
      user: { id: "u1", activeOrganizationId: null },
      headers: { "x-tenant-id": VALID_TENANT_A.toUpperCase() },
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
  });

  it("picks the first value when the header arrives as an array (Express edge case)", async () => {
    const prisma = makePrismaWithRow({ id: "m1" });
    const req: Req = {
      user: { id: "u1", activeOrganizationId: null },
      headers: { "x-tenant-id": [VALID_TENANT_A, "second"] },
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
  });

  it("does not touch DB when there is no req.user (anonymous request with header — caller decides)", async () => {
    const prisma = makePrismaWithRow({ id: "m1" });
    const req: Req = { headers: { "x-tenant-id": VALID_TENANT_A } };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBeNull();
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  // Issue #103 — session.activeOrganizationId fallback
  it("falls back to session.activeOrganizationId when no header is present (issue #103)", async () => {
    const prisma = makePrismaWithRow(null);
    const req: Req = {
      user: { id: "u1", activeOrganizationId: VALID_TENANT_A },
      headers: {},
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
    // No header → no DB lookup needed.
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it("prefers header over session.activeOrganizationId when both are present (header wins)", async () => {
    const prisma = makePrismaWithRow({ id: "m1" });
    const req: Req = {
      user: { id: "u1", activeOrganizationId: VALID_TENANT_B },
      headers: { "x-tenant-id": VALID_TENANT_A },
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBe(VALID_TENANT_A);
  });

  it("returns null when no header and no activeOrganizationId (no tenant scope)", async () => {
    const prisma = makePrismaWithRow(null);
    const req: Req = {
      user: { id: "u1", activeOrganizationId: null },
      headers: {},
    };
    const result = await resolveRequestTenantId(req as never, prisma);
    expect(result).toBeNull();
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });
});
