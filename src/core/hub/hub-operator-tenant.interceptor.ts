import {
  Injectable,
  Optional,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { Observable, defer, from, switchMap } from "rxjs";

import { runWithTenant } from "../multi-tenancy/tenant-context.js";
import { isTenantExempt } from "../multi-tenancy/tenant-guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { resolveHubOperatorTenantId } from "./hub-operator-tenant.js";
import { isHubPortalProtectedPath } from "./hub-portal-paths.js";

/**
 * Hub-scoped tenant interceptor for SINGLE-TENANT deployments.
 *
 * Upstream candidate (hub-operator-tenant.interceptor.ts — see
 * docs/upstream-drafts/README.md "Hub tenant-scoped admin routes (roles)"):
 * the core `TenantInterceptor` is gated on `features.multiTenancy.enabled`
 * (app.module.ts:255), so in a single-tenant deployment
 * (`FEATURE_MULTI_TENANCY_ENABLED=false`) it is never mounted. The core
 * Hub/admin routes still call `requireTenantContext()`, so with no
 * interceptor in the chain they have no tenant in the ALS and throw 400
 * "tenant context is required" — the Roles page hangs in "Loading roles…".
 *
 * This interceptor fills exactly that gap and NOTHING else:
 *
 *   - Only the Hub operator console (`isHubPortalProtectedPath`) needs a
 *     tenant in single-tenant mode. Those requests resolve the operator's
 *     OWN membership tenant via `resolveHubOperatorTenantId` and run the
 *     handler inside `runWithTenant()` so the Prisma RLS extension stamps
 *     `SET app.tenant_id` and `requireTenantContext()` reads a value.
 *   - EVERY other path is pure pass-through. The product `/api/*` surface
 *     pins its own tenant (session `activeOrganizationId` / SINGLE_TENANT_ID
 *     resolvers) and MUST keep running exactly as today — this interceptor
 *     never makes a non-Hub path tenant-required.
 *
 * When the tenant is NOT resolvable (no `req.user`, no Prisma, or the
 * operator has no membership) the interceptor PASSES THROUGH instead of
 * throwing. `isHubPortalProtectedPath` also matches tenant-OPTIONAL hub
 * probes — notably the `@Public` `/hub/portal-access.json` access probe,
 * which decides hub access and MUST answer without a tenant (a
 * membership-less operator gets a "no access" snapshot, not a 400).
 * Throwing here would break those probes. Tenant-REQUIRED handlers
 * (`GET /admin/roles`, …) call `requireTenantContext()` themselves, so
 * with no tenant in the ALS they still throw their own 400 — the
 * "membership-less → 400 on /admin/roles" behaviour is preserved, just
 * enforced by the handler rather than the interceptor.
 *
 * Isolation invariant: the fallback resolves ONLY the caller's own
 * membership — there is no blind `SINGLE_TENANT_ID` fallback, so no
 * foreign-tenant leak (an authenticated user with no membership never
 * inherits another tenant's context). This interceptor and the core
 * `TenantInterceptor` are mutually exclusive: they are wired on opposite
 * sides of the `multiTenancy` flag, so never both active.
 *
 * `runWithTenant` is imported from `tenant-context.ts` (never from
 * `tenant.interceptor.ts`) to avoid the `PrismaService`-before-init cycle
 * documented there.
 */

interface HubAuthenticatedRequest extends Request {
  user?: {
    id: string;
    activeOrganizationId?: string | null;
  };
}

@Injectable()
export class HubOperatorTenantInterceptor implements NestInterceptor {
  /**
   * `@Optional()` mirrors `TenantInterceptor`: synthetic test modules may
   * wire the interceptor without importing `PrismaModule`. Production wiring
   * imports `PrismaModule` (it is `@Global`), so the real path always has a
   * Prisma instance. Without Prisma the membership cannot be resolved, so
   * the request passes through WITHOUT a tenant — tenant-required handlers
   * then throw their own `requireTenantContext()` 400.
   */
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<HubAuthenticatedRequest>();
    const path = (req.originalUrl ?? req.url ?? "/") as string;

    // Public/system paths (/, /health/*, /api/auth/*) — never tenant-scoped.
    if (isTenantExempt(path)) {
      return next.handle();
    }

    const purePath = stripQuery(path);
    // Non-Hub paths (the whole product `/api/*` surface) pin their own tenant
    // and must pass through untouched in single-tenant mode.
    if (!isHubPortalProtectedPath(purePath)) {
      return next.handle();
    }

    return defer(async () => {
      const tenantId =
        req.user && this.prisma ? await resolveHubOperatorTenantId(req.user, this.prisma) : null;
      if (!tenantId) {
        // Tenant not resolvable (no session / no Prisma / no membership).
        // Pass through WITHOUT a tenant instead of throwing — no blind
        // SINGLE_TENANT_ID fallback (that would leak a foreign tenant).
        // Tenant-OPTIONAL hub probes (the @Public /hub/portal-access.json
        // access probe) must answer without a tenant; tenant-REQUIRED
        // handlers (/admin/roles, …) throw their own requireTenantContext()
        // 400, so the membership-less → 400 contract is preserved there.
        return streamToPromise(next.handle());
      }
      return runWithTenant(tenantId, () => streamToPromise(next.handle()));
    }).pipe(switchMap((value) => from(unwrap(value))));
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
