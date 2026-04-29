import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import type { Ability } from "./casl-ability.js";
import { parseTestAbilityHeader } from "./test-ability.js";

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
    const ability = parseTestAbilityHeader(header, process.env.NODE_ENV ?? "");
    if (ability) {
      req.ability = ability;
    }
    next();
  }
}
