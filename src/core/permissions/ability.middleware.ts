import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { resolveRequestTenantId } from "../multi-tenancy/resolve-request-tenant.js";
import { isTenantExempt } from "../multi-tenancy/tenant-guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { type Ability, buildAbility } from "./casl-ability.js";
import { PermissionService } from "./permission.service.js";

interface AuthenticatedRequest extends Request {
  user?: { id: string; tenantId: string | null };
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
    // `/admin/*`, `/dev/*`, `/docs/*`, `/tenants/*`) DO NOT take a
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
      req.ability = buildAbility([]);
      next();
      return;
    }

    let tenantId: string | null;
    try {
      tenantId = await resolveRequestTenantId(req, this.prisma);
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

    if (!tenantId) {
      // No identity / no tenant scope — empty ability. Routes
      // without `@Can()` still pass; routes with it 403 (matches the
      // previous interceptor-only behaviour for anonymous-but-routed
      // requests).
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
}
