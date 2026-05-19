import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { type Observable, from, mergeMap } from "rxjs";

import { buildAbility } from "./casl-ability.js";
import { PermissionService } from "./permission.service.js";

interface AuthenticatedRequest {
  user?: { id: string; tenantId: string; scopes?: string[] };
  ability?: import("./casl-ability.js").Ability;
}

/**
 * `PermissionInterceptor` resolves the active CASL `Ability` per
 * request and attaches it to `request.ability`. Downstream:
 *   - `@Ability()` param decorator reads it
 *   - `CanGuard` (and the upcoming Output-Pipeline Stages 1+2) check
 *     against it
 *
 * Anonymous requests (no `request.user`) get an empty Ability so
 * routes without `@Can()` still pass through and routes WITH `@Can()`
 * deny correctly.
 */
@Injectable()
export class PermissionInterceptor implements NestInterceptor {
  constructor(private readonly permissions: PermissionService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return from(this.attachAbility(req)).pipe(mergeMap(() => next.handle()));
  }

  private async attachAbility(req: AuthenticatedRequest): Promise<void> {
    if (req.ability) return;
    if (!req.user) {
      req.ability = buildAbility([]);
      return;
    }
    req.ability = await this.permissions.abilityFor(req.user.id, req.user.tenantId, {
      scopes: req.user.scopes,
    });
  }
}
