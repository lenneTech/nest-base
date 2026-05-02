import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

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
 * exactly the friction-log finding this slice closes.
 *
 * Skip when:
 *   - `req.ability` is already set (TestAbilityMiddleware in
 *     `NODE_ENV=test`, or a future custom override).
 *   - `req.user` is missing (anonymous requests get an empty
 *     ability so routes without `@Can()` still pass through and
 *     routes WITH `@Can()` deny correctly).
 *   - `req.user.tenantId` is null — same empty-ability fallback;
 *     the user has no tenant context to resolve rules against.
 */
@Injectable()
export class AbilityMiddleware implements NestMiddleware {
  constructor(private readonly permissions: PermissionService) {}

  async use(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
    if (req.ability) {
      next();
      return;
    }
    if (!req.user || !req.user.tenantId) {
      // No identity / no tenant scope — empty ability. Routes
      // without `@Can()` still pass; routes with it 403 (matches
      // the previous interceptor-only behaviour).
      req.ability = buildAbility([]);
      next();
      return;
    }
    try {
      req.ability = await this.permissions.abilityFor(req.user.id, req.user.tenantId);
    } catch {
      // Storage failure must not 500 the request — fall back to an
      // empty ability so the request fails closed (403) rather than
      // open (500 → noise in error budgets).
      req.ability = buildAbility([]);
    }
    next();
  }
}
