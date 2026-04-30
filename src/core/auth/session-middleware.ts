import {
  Inject,
  Injectable,
  type LoggerService,
  Logger,
  type NestMiddleware,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";

import { isPathProtected } from "./jwt-middleware.js";
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from "./better-auth.token.js";

/**
 * Session-aware request augmentation.
 *
 * Mirrors what `PermissionInterceptor` and the `@Ability()` param
 * decorator already expect on the request. Kept minimal — middleware
 * downstream / domain code only reads `id` and `tenantId`.
 */
export interface AuthenticatedRequest extends Request {
  user?: { id: string; tenantId: string | null };
}

/**
 * BetterAuthSessionMiddleware
 *
 * Reads the Better-Auth session cookie / Authorization header, looks
 * up the matching user, and assigns `req.user = { id, tenantId }` for
 * downstream interceptors and guards. Anonymous requests on protected
 * paths are rejected with `401 Unauthorized`.
 *
 * Why a middleware (rather than a guard or interceptor): the user
 * lookup happens once per request, before *any* other guard or
 * interceptor runs (`PermissionInterceptor`, `TenantInterceptor`).
 * `req.user` is the contract every layer in the system reads from;
 * pulling the lookup into a middleware keeps the request path
 * deterministic.
 *
 * Public paths (per `isPathProtected`) skip the auth requirement —
 * `/`, `/health/*`, `/api/auth/*`, `/docs/*`, `/dev/*`. Authenticated
 * users on those paths still get `req.user` populated when a valid
 * session cookie is present, so logging / per-user diagnostics see
 * the real user.
 */
@Injectable()
export class BetterAuthSessionMiddleware implements NestMiddleware {
  private readonly logger: LoggerService = new Logger("BetterAuthSession");

  constructor(
    @Optional()
    @Inject(BETTER_AUTH_INSTANCE)
    private readonly auth: BetterAuthInstance | null = null,
  ) {}

  async use(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
    const path = (req.originalUrl ?? req.url ?? "/") as string;
    const protectedPath = isPathProtected(stripQuery(path));

    // Auth is opt-in — the BetterAuthModule returns `null` when
    // `BETTER_AUTH_SECRET` isn't set. With no auth subsystem we can't
    // look up sessions. Don't 401 here: a project that hasn't
    // configured Better-Auth (e.g. a fresh starter, or an admin /
    // diagnostics-only deployment) should still be reachable. The
    // permission interceptor + `@Can()` decorators are what actually
    // gate access; with `req.user` undefined every CASL ability is
    // empty and `@Can()` denies anyway.
    if (!this.auth) {
      next();
      return;
    }

    let session: SessionLookup = null;
    try {
      session = (await this.auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      })) as SessionLookup;
    } catch (err) {
      // A malformed / expired cookie should NOT 500. Better-Auth
      // throws `APIError` on certain edge-cases (revoked session,
      // bad signature). Treat as anonymous — protected paths handle
      // the 401 below.
      this.logger.debug?.(`session lookup failed: ${(err as Error).message}`);
      session = null;
    }

    if (session?.user) {
      req.user = {
        id: session.user.id,
        tenantId: extractTenantId(session.user),
      };
      next();
      return;
    }

    if (protectedPath) {
      throw new UnauthorizedException("Authentication required.");
    }
    next();
  }
}

interface SessionUser {
  id: string;
  tenantId?: string | null;
}

type SessionLookup = { user: SessionUser } | null;

function extractTenantId(user: SessionUser): string | null {
  // `tenantId` is declared as `additionalFields.tenantId` on the
  // Better-Auth user; the adapter projects it through. May be null
  // for users that haven't been linked to a tenant yet.
  return user.tenantId ?? null;
}

function stripQuery(path: string): string {
  const queryAt = path.indexOf("?");
  const hashAt = path.indexOf("#");
  const cut = Math.min(...[queryAt, hashAt].filter((i) => i >= 0), path.length);
  return path.slice(0, cut);
}
