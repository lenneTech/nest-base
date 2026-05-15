import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
  createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { Ability, AbilityAction, AbilitySubjectType } from "./casl-ability.js";

/**
 * `@Can()` decorator + `CanGuard` + `@Ability()` param decorator
 *.
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
  private readonly logger = new Logger(CanGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // MAJ-4: `getAllAndOverride` checks the method handler first, then the
    // controller class. This ensures class-level `@Can()` decorators are
    // also honoured. Method-level metadata takes precedence when both are
    // present (standard NestJS reflection override semantics).
    const meta = this.reflector.getAllAndOverride<CanMetadata | undefined>(CAN_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return true;

    const req = context.switchToHttp().getRequest<RequestWithAbility>();
    const ability = req.ability;
    if (!ability) {
      // Generic user-facing message — do NOT echo (action, subject)
      // back to the client. Anonymous probes would otherwise enumerate
      // the API surface and learn which subjects exist. Reason lands
      // server-side for ops debugging.
      this.logger.warn(`forbidden: no ability for ${meta.action}:${String(meta.subject)}`);
      throw new ForbiddenException("forbidden");
    }
    if (!ability.can(meta.action, meta.subject)) {
      this.logger.warn(`forbidden: ${meta.action}:${String(meta.subject)} denied`);
      throw new ForbiddenException("forbidden");
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
