import {
  Injectable,
  Optional,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { Observable, defer, from, switchMap } from "rxjs";

import { PrismaService } from "../prisma/prisma.service.js";
import { isHubPortalProtectedPath, prefersHubPortalHtmlResponse } from "../hub/hub-portal-paths.js";
import { resolveHubOperatorTenantId } from "../hub/hub-operator-tenant.js";
import { resolveRequestTenantId } from "./resolve-request-tenant.js";
import { getCurrentTenantId, runWithTenant } from "./tenant-context.js";
import { isTenantExempt } from "./tenant-guard.js";
import { parseTenantHeader } from "./tenant-header.js";

/**
 * Tenant-Interceptor + AsyncLocalStorage container.
 *
 * Reads the tenant header on every inbound request and runs the rest of
 * the handler chain inside `runWithTenant()`. Domain code reads the
 * tenant via `getCurrentTenantId()` — no parameter threading. Public
 * paths (/, /health/*, /api/auth/*) are exempt.
 *
 * The Prisma extension that stamps `SET app.tenant_id = $1` on each
 * Postgres connection (added in a follow-up slice) reads from the same
 * storage so RLS policies see the right value.
 *
 * Cross-tenant write breach fix (LLM-test 2026-05-03 #20:21):
 *   For authenticated requests, the interceptor now runs the
 *   `resolveRequestTenantId(req, prisma)` helper — the same single
 *   source of truth `AbilityMiddleware` uses. A header pointing at a
 *   tenant the user has no ACTIVE membership in throws
 *   `ForbiddenException` (403). Unauthenticated requests on
 *   tenant-required paths fail without a session + set-active.
 */

// `getCurrentTenantId` and `runWithTenant` are re-exported from
// `tenant-context.ts` to keep existing imports working. The container
// lives in its own file so `PrismaService` (which reads
// `getCurrentTenantId()` in `runWithRlsTenant`) doesn't pull in this
// interceptor — and through it, `PrismaService` itself — at module-
// load time. The cycle manifested as
// `ReferenceError: Cannot access 'PrismaService' before initialization`.
export { getCurrentTenantId, runWithTenant };

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    tenantId: string | null;
    /**
     * Active organization id from the Better-Auth session (issue #103).
     * Projected by `BetterAuthSessionMiddleware`; undefined when the
     * org plugin is off or no org has been activated this session.
     */
    activeOrganizationId?: string | null;
  };
}

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  /**
   * `@Optional()` because synthetic test modules (e.g. the existing
   * `tenant-interceptor-mount.e2e-spec.ts`) wire the interceptor up
   * without bringing in `PrismaModule`. Production wiring imports
   * `PrismaModule` (it's `@Global`), so the real path always has a
   * Prisma instance. When prisma is undefined we fall back to the
   * legacy parse-only behaviour for authenticated requests too — the
   * membership check is best-effort, not load-bearing for test
   * fixtures that don't talk to a DB.
   */
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = (req.originalUrl ?? req.url ?? "/") as string;

    if (isTenantExempt(path)) {
      return next.handle();
    }

    return defer(async () => {
      // Authenticated path: defer to the unified resolver. It throws
      // 403 on header-without-membership and 400 on malformed UUIDs.
      // The resolved tenant id flows through `runWithTenant` so the
      // ability middleware (which runs AFTER this interceptor in
      // Nest's `middleware → guards → interceptors → pipes` chain via
      // its own resolver call) and `runWithRlsTenant` see the same
      // value. RLS + CASL can no longer disagree.
      if (req.user && this.prisma) {
        const purePath = stripQuery(path);
        const acceptHeader = Array.isArray(req.headers.accept)
          ? req.headers.accept[0]
          : req.headers.accept;
        let tenantId = await resolveRequestTenantId(req, this.prisma, { path: purePath });
        if (
          !tenantId &&
          isHubPortalProtectedPath(purePath) &&
          prefersHubPortalHtmlResponse({ method: req.method, acceptHeader })
        ) {
          tenantId = await resolveHubOperatorTenantId(req.user, this.prisma);
        }
        if (!tenantId) {
          // No header AND no session tenant on a non-exempt route is
          // exactly what `parseTenantHeader` used to throw on. Mirror
          // that behaviour so existing tests / consumers see the same
          // error shape. We re-invoke parseTenantHeader so the
          // TenantIsolationError signal stays consistent.
          parseTenantHeader(undefined);
        }
        return runWithTenant(tenantId as string, () => streamToPromise(next.handle()));
      }
      // Unauthenticated: no tenant without a Better-Auth session.
      parseTenantHeader(undefined);
      throw new Error("unreachable: parseTenantHeader always throws");
    }).pipe(
      switchMap((value) => from(unwrap(value))),
      // Errors from `defer`'s async factory propagate naturally — no
      // explicit catch needed; the global exception filter maps
      // ForbiddenException → 403 / BadRequestException → 400.
    );
  }
}

function streamToPromise(observable: Observable<unknown>): Promise<unknown> {
  return new Promise((resolveResult, rejectResult) => {
    let last: unknown;
    observable.subscribe({
      next: (v) => {
        last = v;
      },
      error: rejectResult,
      complete: () => resolveResult(last),
    });
  });
}

function unwrap(value: unknown): Promise<unknown> {
  return Promise.resolve(value);
}

function stripQuery(path: string): string {
  const queryAt = path.indexOf("?");
  const hashAt = path.indexOf("#");
  const cut = Math.min(...[queryAt, hashAt].filter((i) => i >= 0), path.length);
  return path.slice(0, cut);
}
