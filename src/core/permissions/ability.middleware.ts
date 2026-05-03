import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { PrismaService } from "../prisma/prisma.service.js";
import { type Ability, buildAbility } from "./casl-ability.js";
import { PermissionService } from "./permission.service.js";

interface AuthenticatedRequest extends Request {
  user?: { id: string; tenantId: string | null };
  ability?: Ability;
}

const TENANT_HEADER = "x-tenant-id";
// Strict UUID — duplicates `tenant-header.ts`'s validator on purpose:
// the middleware fallback runs BEFORE `TenantInterceptor`, so we
// can't rely on its parsing. A bad header here MUST NOT touch the
// DB lookup (no log-injection / typo amplification).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * AbilityMiddleware — resolves the active CASL `Ability` per request
 * and attaches it to `req.ability` BEFORE NestJS runs guards.
 *
 * Why a middleware instead of an interceptor: NestJS' request
 * lifecycle is **middleware → guards → interceptors → pipes → handler**.
 * `CanGuard` reads `req.ability`; if the ability is set in an
 * interceptor (which runs AFTER guards) the guard always sees
 * `undefined` and denies every authenticated request — which is
 * exactly the friction-log finding this slice closes.
 *
 * Skip when:
 *   - `req.ability` is already set (TestAbilityMiddleware in
 *     `NODE_ENV=test`, or a future custom override).
 *   - `req.user` is missing (anonymous requests get an empty
 *     ability so routes without `@Can()` still pass through and
 *     routes WITH `@Can()` deny correctly).
 *   - `req.user.tenantId` is null AND no valid `x-tenant-id` header
 *     identifies an ACTIVE membership — same empty-ability fallback;
 *     the user has no tenant context to resolve rules against.
 *
 * x-tenant-id fallback: when `req.user.tenantId` is null we look at
 * the request header. If the header is a UUID AND the user has an
 * `ACTIVE` `TenantMember` row for that tenant, we resolve the
 * ability with that tenant. Closes friction-log blocker (LLM-test
 * 2026-05-03 #4): users created BEFORE the storage-side primary
 * patch lands still have null `User.tenantId` even after they have
 * memberships, and users with multiple memberships need the header
 * to switch tenant context. Trusting the header without the
 * membership check would be a privilege-escalation, so the
 * `findFirst({ status: "ACTIVE", ... })` lookup is non-negotiable.
 */
@Injectable()
export class AbilityMiddleware implements NestMiddleware {
  constructor(
    private readonly permissions: PermissionService,
    private readonly prisma: PrismaService,
  ) {}

  async use(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
    if (req.ability) {
      next();
      return;
    }
    if (!req.user) {
      req.ability = buildAbility([]);
      next();
      return;
    }
    const sessionTenant = req.user.tenantId;
    const tenantId = sessionTenant ?? (await this.resolveHeaderTenantId(req));
    if (!tenantId) {
      // No identity / no tenant scope — empty ability. Routes
      // without `@Can()` still pass; routes with it 403 (matches
      // the previous interceptor-only behaviour).
      req.ability = buildAbility([]);
      next();
      return;
    }
    try {
      req.ability = await this.permissions.abilityFor(req.user.id, tenantId);
    } catch {
      // Storage failure must not 500 the request — fall back to an
      // empty ability so the request fails closed (403) rather than
      // open (500 → noise in error budgets).
      req.ability = buildAbility([]);
    }
    next();
  }

  /**
   * Returns the header-supplied tenant id only if the user has an
   * ACTIVE membership row for it. Returns null on any other path
   * (missing header, malformed UUID, no membership, INVITED /
   * SUSPENDED status, or DB failure) so the caller can fall through
   * to the empty-ability branch (fail-closed).
   */
  private async resolveHeaderTenantId(req: AuthenticatedRequest): Promise<string | null> {
    const userId = req.user?.id;
    if (!userId) return null;
    const headerValue = req.headers?.[TENANT_HEADER];
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!raw || !UUID_RE.test(raw)) return null;
    const tenantId = raw.toLowerCase();
    try {
      const member = await this.prisma.tenantMember.findFirst({
        where: { userId, tenantId, status: "ACTIVE" },
        select: { id: true },
      });
      return member ? tenantId : null;
    } catch {
      return null;
    }
  }
}
