import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Request } from "express";

import { CORE_ERROR_CODES } from "../errors/error-code.js";
import type { PrismaService } from "../prisma/prisma.service.js";

/**
 * Single source of truth for "what tenant id does this request operate
 * in?" — used by BOTH `TenantInterceptor` (RLS / `runWithTenant`) and
 * `AbilityMiddleware` (CASL ability) so the auth-tenant and the
 * data-tenant cannot disagree.
 *
 * Why one helper instead of two:
 *   Before this change, `TenantInterceptor` blindly trusted the header
 *   (set RLS to whatever Bob sent) and `AbilityMiddleware`
 *   short-circuited on `req.user.tenantId` (built CASL for Bob's
 *   primary tenant). Bob could `POST /examples` with
 *   `x-tenant-id: <aliceTenantId>`: RLS wrote into Alice's tenant
 *   while CanGuard's @Can('create','Example') type-only check (CASL
 *   doesn't evaluate `tenantId == $CURRENT_TENANT` without a subject
 *   instance) PERMITTED. Cross-tenant write breach.
 *
 * Resolution rules (in order):
 *   1. Header present, malformed UUID → `BadRequestException`. Don't
 *      echo `raw` into the error or the DB query — header values are
 *      attacker-controlled and the same hardening as
 *      `parseTenantHeader` applies (no log injection / no Prisma WHERE
 *      with garbage strings).
 *   2. Header present, no `req.user` → return `null`. Anonymous
 *      callers can't have an ACTIVE membership; the caller (currently
 *      only the interceptor on non-exempt unauth paths) decides what
 *      `null` means in its context.
 *   3. Header present, `req.user.id` set → look up an `ACTIVE`
 *      `TenantMember` row for `(userId, tenantId)`. ACTIVE membership →
 *      return that tenant id (this becomes the authoritative id for
 *      both layers). No membership / `INVITED` / `SUSPENDED` →
 *      `ForbiddenException`. Storage failure → re-throw (callers
 *      decide; the middleware fails closed = empty ability rather
 *      than fail open = silent fallback to a foreign tenant).
 *   4. No header, `req.user.activeOrganizationId` non-null → return it.
 *      The Better-Auth organization plugin writes this to the session
 *      when the client calls POST /api/auth/organization/set-active.
 *      `BetterAuthSessionMiddleware` projects it onto `req.user` so
 *      clients can omit the x-tenant-id header after activating an org
 *      (issue #103).
 *   5. No header, `req.user.tenantId` non-null → return it. This is
 *      the "session tenant" for users with a single primary tenant.
 *   6. No header, no session tenant → return `null`.
 *
 * The cache hint on `req.__resolvedTenantId` is intentionally not set
 * here — both call sites are independent (interceptor runs before
 * middleware, the latter just re-runs the resolver). Caching would
 * complicate the test surface for negligible win on a single
 * `findFirst` per request.
 */

const TENANT_HEADER = "x-tenant-id";
// Strict UUID validator — duplicates `tenant-header.ts`'s validator on
// purpose. The resolver runs at TWO call sites with independent error
// shapes (BadRequest vs TenantIsolationError); sharing the regex keeps
// drift impossible without sharing the throw.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    tenantId: string | null;
    /**
     * Active organization id set by the Better-Auth organization plugin
     * when the client called `POST /api/auth/organization/set-active`.
     * The session row carries this value; `BetterAuthSessionMiddleware`
     * projects it onto `req.user` so downstream code never has to reach
     * back into the session. May be undefined when the org plugin is
     * disabled or when no org has been activated for this session.
     */
    activeOrganizationId?: string | null;
  };
}

export async function resolveRequestTenantId(
  req: AuthenticatedRequest,
  prisma: Pick<PrismaService, "tenantMember">,
): Promise<string | null> {
  const headerValue = req.headers?.[TENANT_HEADER];
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (raw) {
    if (!UUID_RE.test(raw)) {
      // Generic error message — the real (potentially log-poisoned)
      // value lands in request-context server-side, not in the
      // response body or DB query.
      throw new BadRequestException({
        statusCode: 400,
        code: CORE_ERROR_CODES.VALIDATION,
        message: "x-tenant-id header must be a UUID",
      });
    }
    const tenantId = raw.toLowerCase();
    const userId = req.user?.id;
    if (!userId) {
      // Anonymous caller can't prove membership — caller decides.
      // (The interceptor's only path that hits this is non-exempt
      // unauth, which today's tenant-guard's exempt set already covers
      // for system / health / docs routes.)
      return null;
    }
    // Short-circuit when the header just echoes the user's primary
    // tenant. By the `createTenantWithMember` invariant (PR #63 part
    // 1), a non-null `User.tenantId` implies an ACTIVE `TenantMember`
    // row for the same tenant — so the lookup would round-trip just
    // to confirm what we already know. The breach is the
    // header ≠ session-tenant case; this branch is the no-op case.
    if (req.user?.tenantId && req.user.tenantId === tenantId) {
      return tenantId;
    }
    const member = await prisma.tenantMember.findFirst({
      where: { userId, tenantId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!member) {
      // Hard 403, never silent fallback. This is the security-relevant
      // bit: a user targeting a tenant they don't actively belong to
      // must NOT have their request "rerouted" to their primary
      // tenant — the client is asking for a specific scope, deny it.
      throw new ForbiddenException({
        statusCode: 403,
        code: CORE_ERROR_CODES.FORBIDDEN,
        message: "no active membership for the requested tenant",
      });
    }
    return tenantId;
  }

  // No header → fall back to the session's active organization id first
  // (issue #103). When the Better-Auth organization plugin is enabled,
  // the client can call POST /api/auth/organization/set-active once and
  // then omit the x-tenant-id header on subsequent requests; the active
  // org id travels in the session and is projected here by
  // BetterAuthSessionMiddleware. If that is absent, fall back to the
  // user's primary tenant id. Either value may be null (anonymous route,
  // or user not yet linked to a tenant); callers decide what null means.
  return req.user?.activeOrganizationId ?? req.user?.tenantId ?? null;
}
