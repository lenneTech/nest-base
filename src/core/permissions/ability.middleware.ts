import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { resolveHubOperatorTenantId } from "../hub/hub-operator-tenant.js";
import { isHubPortalProtectedPath, isHubPortalStaticAsset } from "../hub/hub-portal-paths.js";
import { resolveRequestTenantId } from "../multi-tenancy/resolve-request-tenant.js";
import { isTenantExempt } from "../multi-tenancy/tenant-guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { type Ability, buildAbility } from "./casl-ability.js";
import { PermissionService } from "./permission.service.js";

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    /**
     * Active organization id from the Better-Auth session (issue #103).
     * Projected by `BetterAuthSessionMiddleware`; undefined when the
     * org plugin is off or no org has been activated this session.
     * `resolveRequestTenantId` reads this as the preferred fallback
     * from Better-Auth `set-active` (session-only tenant resolution).
     */
    activeOrganizationId?: string | null;
    /** Present when the request is authenticated via a scoped API key. */
    scopes?: string[];
  };
  ability?: Ability;
}

/**
 * AbilityMiddleware — resolves the active CASL `Ability` per request
 * and attaches it to `req.ability` BEFORE NestJS runs guards.
 *
 * Why a middleware instead of an interceptor: NestJS' request
 * lifecycle is **middleware → guards → interceptors → pipes → handler**.
 * `CanGuard` reads `req.ability`; if the ability is set in an
 * interceptor (which runs AFTER guards) the guard always sees
 * `undefined` and denies every authenticated request — which is
 * exactly the friction-log finding the previous slice closed.
 *
 * Cross-tenant write breach fix (LLM-test 2026-05-03 #20:21):
 *   The middleware now defers to `resolveRequestTenantId(req, prisma)`
 *   — the SAME helper `TenantInterceptor` calls — so the auth tenant
 *   (used by CanGuard) and the data tenant (used by RLS) cannot
 *   disagree. The previous `sessionTenant ?? resolveHeader` short-
 *   circuit was the breach vector: it built CASL for Bob's primary
 *   tenant while the interceptor blindly trusted Bob's
 *   `x-tenant-id: <aliceTenantId>` and set RLS to Alice's tenant. The
 *   row landed in Alice's table and `@Can('create','Example')` (a
 *   type-only check that doesn't evaluate the
 *   `tenantId == $CURRENT_TENANT` condition without a subject
 *   instance) PERMITTED.
 *
 * Layered responsibility for the unified resolver:
 *   - The HARD 403 belongs in `TenantInterceptor` — that's the layer
 *     that gates RLS, so a 403 there blocks the write at the data
 *     layer before the controller even runs.
 *   - This middleware installs `req.ability`. On resolver failure it
 *     falls back to an EMPTY ability rather than re-raising — so
 *     non-`@Can()` routes (like the `/me/*` family or a controller
 *     that scopes by `req.user.id`) don't spuriously 403 when a
 *     client forwards a stray tenant header. `@Can()`-gated routes
 *     still deny via `CanGuard` because empty ability grants nothing.
 *
 * Skip the resolver entirely when:
 *   - `req.ability` is already set (TestAbilityMiddleware in
 *     `NODE_ENV=test`, or a future custom override).
 *   - `req.user` is missing (anonymous requests → empty ability).
 *   - The path is tenant-exempt (`/me/*`, `/health/*`, …) — those
 *     routes are not allowed to be `@Can()`-gated and should not
 *     trigger a membership lookup just because the client sent a
 *     header.
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

    // Tenant-exempt paths (`/`, `/health/*`, `/api/auth/*`, `/me/*`,
    // `/docs/*`, `/hub/static/*`, …) DO NOT take a
    // tenant header — they scope by `req.user.id` (or are public). The
    // resolver MUST NOT raise on them just because the client happens
    // to send a header (e.g. a frontend that forwards x-tenant-id on
    // every request). Empty ability is correct: the route is either
    // `@Public()` (handler runs unauthenticated-equivalent) or it
    // gates by user id directly, not by a CASL Can rule for a tenant.
    // Only consult the classifier when the request actually carries a
    // path — unit tests construct synthetic req objects without
    // originalUrl/url and want the resolver to run unconditionally.
    const path = (req.originalUrl ?? req.url) as string | undefined;
    if (path && isTenantExempt(path)) {
      if (req.user && isHubOperatorAbilityPath(path)) {
        await this.attachAbilityForUser(req, () =>
          resolveHubOperatorTenantId(req.user!, this.prisma),
        );
      } else {
        req.ability = buildAbility([]);
      }
      next();
      return;
    }

    let tenantId: string | null;
    try {
      tenantId = await resolveRequestTenantId(req, this.prisma, path !== undefined ? { path } : {});
    } catch {
      // The resolver throws ForbiddenException / BadRequestException
      // for security-relevant input (header for a tenant the user
      // can't act in / malformed UUID). The HARD throw belongs in
      // `TenantInterceptor` — that's where the request gets rejected
      // before it touches RLS or the controller, closing the
      // cross-tenant write breach. Here we use the throw as a SIGNAL
      // to install an empty ability: the request still passes through
      // the middleware (so non-`@Can()` routes that ignore the tenant
      // don't 403 spuriously), but `@Can()`-gated routes deny via
      // `CanGuard` because the empty ability grants nothing. Both
      // layers agree on the resolved tenant — the interceptor decides
      // the request's fate, the middleware decides the ability.
      req.ability = buildAbility([]);
      next();
      return;
    }

    await this.attachAbilityForUser(req, async () => {
      if (tenantId) return tenantId;
      const purePath = stripQuery(path ?? "/");
      if (req.user && isHubPortalProtectedPath(purePath)) {
        return resolveHubOperatorTenantId(req.user, this.prisma);
      }
      return null;
    });
    next();
  }

  private async attachAbilityForUser(
    req: AuthenticatedRequest,
    resolveTenantId: () => Promise<string | null>,
  ): Promise<void> {
    if (!req.user) {
      req.ability = buildAbility([]);
      return;
    }
    let tenantId: string | null;
    try {
      tenantId = await resolveTenantId();
    } catch {
      req.ability = buildAbility([]);
      return;
    }
    if (!tenantId) {
      req.ability = buildAbility([]);
      return;
    }
    try {
      req.ability = await this.permissions.abilityFor(req.user.id, tenantId, {
        scopes: req.user.scopes,
      });
    } catch {
      req.ability = buildAbility([]);
    }
  }
}

/** `/hub/*` JSON/HTML uses `@Can(Hub)` with hub-operator tenant fallback. */
function isHubOperatorAbilityPath(path: string): boolean {
  const pure = stripQuery(path);
  if (isHubPortalStaticAsset(pure)) return false;
  return pure === "/hub" || pure.startsWith("/hub/");
}

function stripQuery(path: string): string {
  const queryAt = path.indexOf("?");
  const hashAt = path.indexOf("#");
  const cut = Math.min(...[queryAt, hashAt].filter((i) => i >= 0), path.length);
  return path.slice(0, cut);
}
