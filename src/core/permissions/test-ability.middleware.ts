import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import type { Ability } from "./casl-ability.js";
import { parseTestAbilityHeaderForRequest } from "./test-ability.js";

interface AbilityRequest extends Request {
  ability?: Ability;
}

/**
 * Middleware that honours the `X-Test-Ability` header in test mode
 * only.
 *
 * Why a middleware (not an interceptor): NestJS guards run BEFORE
 * interceptors, and `CanGuard` reads `req.ability` to make its
 * decision. Pre-seeding the ability has to happen earlier in the
 * lifecycle — middleware runs before guards.
 *
 * Outside `NODE_ENV=test` the planner returns null and the middleware
 * is a strict no-op. The header is still readable in production logs
 * but never affects authorization.
 */
@Injectable()
export class TestAbilityMiddleware implements NestMiddleware {
  use(req: AbilityRequest, _res: Response, next: NextFunction): void {
    const header = req.headers["x-test-ability"];
    // Uses the cached `NODE_ENV` captured at module load.
    // Runtime mutations from individual specs cannot disable the hatch
    // for the rest of the worker — see test-ability.ts for the rationale.
    const ability = parseTestAbilityHeaderForRequest(header);
    if (ability) {
      req.ability = ability;
    }
    next();
  }
}
