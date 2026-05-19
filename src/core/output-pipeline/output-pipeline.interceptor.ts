import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type Observable, map } from "rxjs";

import { CAN_METADATA_KEY, type CanMetadata } from "../permissions/can.guard.js";
import type { Ability } from "../permissions/casl-ability.js";
import { processOutputResponse } from "./process-output-response.js";

interface RequestWithAbility {
  ability?: Ability;
}

/**
 * Global Output-Pipeline interceptor.
 *
 * When `req.ability` is set and the handler carries `@Can(action, subject)`,
 * runs the full pipeline (Stage 2 field allowlist + Stages 3–4). Otherwise
 * runs secret-strip + safety-net only (public routes, tenant-exempt `/me/*`).
 */
@Injectable()
export class OutputPipelineInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithAbility>();
    const subject = this.resolveOutputSubject(context);
    return next
      .handle()
      .pipe(map((value) => processOutputResponse(value, { ability: req.ability, subject })));
  }

  private resolveOutputSubject(context: ExecutionContext): string | undefined {
    const meta = this.reflector.getAllAndOverride<CanMetadata | undefined>(CAN_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return meta?.subject;
  }
}
