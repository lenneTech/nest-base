import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, map } from 'rxjs';

import { removeSecrets } from './remove-secrets.js';
import { applySafetyNet } from './safety-net.js';

/**
 * Global Output-Pipeline interceptor (PLAN.md §7).
 *
 * Runs Stages 3 (strip secrets) + 4 (safety-net) on every controller
 * response. Stages 1 (record-level permission filter) and 2 (field
 * allowlist) require an `Ability` resolvable from the request — that
 * activates once auth is wired and a `request.user` carries one.
 *
 * The two stages we run unconditionally are the cheapest defence in
 * depth: known secret-shaped keys (passwordHash, sessionToken, …) get
 * stripped from any handler return value before it leaves the server,
 * regardless of whether the controller author remembered to do it.
 */
@Injectable()
export class OutputPipelineInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value) => this.process(value)));
  }

  private process(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    // Stage 3 — strip known-secret keys recursively
    const stripped = removeSecrets(value);
    // Stage 4 — safety net (mask mode in the global path so a missed
    // secret-shaped field surfaces as `[redacted]` rather than crashing
    // the response; controllers that need the strict 'throw' behaviour
    // can wrap themselves in the full `OutputPipeline` class).
    return applySafetyNet(stripped, { mode: 'mask' });
  }
}
