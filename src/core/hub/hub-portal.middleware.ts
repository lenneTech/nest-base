import {
  ForbiddenException,
  Injectable,
  type NestMiddleware,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { loadFeatures } from "../features/features.js";
import type { Ability } from "../permissions/casl-ability.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { canAccessHub, canAccessTenantAdmin } from "./hub-portal-access.js";
import {
  isHubCockpitPath,
  isHubPortalAccessProbePath,
  isHubPortalProtectedPath,
  isTenantAdminPortalPath,
  prefersHubPortalLoginRedirect,
} from "./hub-portal-paths.js";
import { evaluateHubPortalRequestOutsideDev } from "./hub-surface-policy.js";

interface HubPortalRequest extends Request {
  user?: { id: string };
  ability?: Ability;
}

/**
 * Enforces CASL on `/hub/*` and `/admin/*` after the session + ability
 * middleware ran. Anonymous requests are already rejected by
 * `BetterAuthSessionMiddleware`; this layer denies authenticated users
 * without Hub (`read Hub` / `manage:all`) or tenant-admin subjects on
 * `/admin/*`.
 *
 * Outside development the decision comes from
 * `evaluateHubPortalRequestOutsideDev()`:
 *   - `FEATURE_HUB_ENABLED` unset/false → inert pass-through, the
 *     controllers keep today's behaviour (dev-gated routes 404 via
 *     `assertHubSurfaceAvailable`).
 *   - flag on → an authenticated session whose ability passes
 *     `canAccessHub` (for `/hub/*`) resp. `canAccessTenantAdmin` (for
 *     `/admin/*`) is REQUIRED; every other request gets the same 404 a
 *     disabled hub produces. Deliberately no dev-style redirect and no
 *     403 — an unauthorized caller must not be able to distinguish an
 *     opted-in deployment from one without the flag.
 */
@Injectable()
export class HubPortalMiddleware implements NestMiddleware {
  use(req: HubPortalRequest, res: Response, next: NextFunction): void {
    const path = stripQuery((req.originalUrl ?? req.url ?? "/") as string);
    if (!isHubPortalProtectedPath(path)) {
      next();
      return;
    }

    if (serverConfigFromEnv(process.env).env !== "development") {
      const decision = evaluateHubPortalRequestOutsideDev({
        hubEnabled: loadFeatures(process.env as Record<string, string | undefined>).hub.enabled,
        authenticated: Boolean(req.user?.id),
        isProbePath: isHubPortalAccessProbePath(path),
        isCockpitPath: isHubCockpitPath(path),
        isTenantAdminPath: isTenantAdminPortalPath(path),
        hubAllowed: canAccessHub(req.ability),
        tenantAdminAllowed: canAccessTenantAdmin(req.ability),
      });
      if (decision === "not-found") {
        throw new NotFoundException();
      }
      // "allow" and "pass-through" both continue: the surface guard in
      // the controllers decides availability (tier + flag), this layer
      // only decided authentication/authorization.
      next();
      return;
    }

    // Development from here on — unchanged semantics.

    // Let the SPA read `{ hub, tenantAdmin }` even when the operator lacks
    // `read Hub` — the React gate renders the friendly denial screen.
    if (isHubPortalAccessProbePath(path)) {
      next();
      return;
    }

    const acceptHeader = Array.isArray(req.headers.accept)
      ? req.headers.accept[0]
      : req.headers.accept;

    const hubAllowed = canAccessHub(req.ability);
    const tenantAdminAllowed = canAccessTenantAdmin(req.ability);
    const surfaceAllowed =
      (isHubCockpitPath(path) && hubAllowed) ||
      (isTenantAdminPortalPath(path) && tenantAdminAllowed) ||
      isHubPortalAccessProbePath(path);

    if (!req.user?.id) {
      if (surfaceAllowed) {
        next();
        return;
      }
      if (
        prefersHubPortalLoginRedirect({
          path,
          method: req.method,
          acceptHeader,
        })
      ) {
        res.redirect(302, "/");
        return;
      }
      throw new UnauthorizedException("Authentication required.");
    }

    if (!surfaceAllowed) {
      if (
        prefersHubPortalLoginRedirect({
          path,
          method: req.method,
          acceptHeader,
        })
      ) {
        res.redirect(302, "/?access=hub");
        return;
      }
      throw new ForbiddenException(
        isTenantAdminPortalPath(path) ? "Tenant admin access required." : "Hub access required.",
      );
    }

    next();
  }
}

function stripQuery(path: string): string {
  const queryAt = path.indexOf("?");
  const hashAt = path.indexOf("#");
  const cut = Math.min(...[queryAt, hashAt].filter((i) => i >= 0), path.length);
  return path.slice(0, cut);
}
