import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { Ability, AbilityAction, AbilitySubjectType } from "./casl-ability.js";

/**
 * `@Can()` decorator + `CanGuard` + `@Ability()` param decorator
 * (PLAN.md §32 Phase 3).
 *
 *   @Can('read', 'Project')
 *   @Get()
 *   listProjects(@Ability() ability: Ability) { ... }
 *
 * Flow:
 *  - The PermissionInterceptor (built next on top of `PermissionService`)
 *    attaches the active `Ability` to `request.ability` for every
 *    authenticated request.
 *  - `CanGuard` reads the (action, subject) metadata set by `@Can()`,
 *    pulls `request.ability`, and either lets the request through or
 *    throws `ForbiddenException`.
 *  - `@Ability()` is the param decorator that hands the ability to the
 *    handler when the controller wants to do programmatic checks
 *    (e.g. record-level filters).
 */

export const CAN_METADATA_KEY = "core:can";

export interface CanMetadata {
  action: AbilityAction;
  subject: AbilitySubjectType;
}

export const Can = (action: AbilityAction, subject: AbilitySubjectType): MethodDecorator =>
  SetMetadata(CAN_METADATA_KEY, { action, subject } satisfies CanMetadata);

interface RequestWithAbility {
  ability?: Ability;
}

@Injectable()
export class CanGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<CanMetadata | undefined>(
      CAN_METADATA_KEY,
      context.getHandler(),
    );
    if (!meta) return true;

    const req = context.switchToHttp().getRequest<RequestWithAbility>();
    const ability = req.ability;
    if (!ability) {
      throw new ForbiddenException("no ability attached to request");
    }
    if (!ability.can(meta.action, meta.subject)) {
      throw new ForbiddenException(`forbidden: ${meta.action}:${String(meta.subject)}`);
    }
    return true;
  }
}

/**
 * Param decorator that hands the active `Ability` to the handler.
 *
 *   listProjects(@Ability() ability: Ability) { ... }
 */
export const AbilityParam = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<RequestWithAbility>();
  return req.ability;
});

// Re-export under the documented public name to match `@Ability()` from
// the slice description while keeping the ESM symbol unambiguous.
export { AbilityParam as Ability };
