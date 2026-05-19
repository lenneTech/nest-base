import {
  ForbiddenException,
  Injectable,
  type NestMiddleware,
  UnauthorizedException,
} from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import type { Ability } from "../permissions/casl-ability.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { canAccessDevHub } from "./hub-portal-access.js";
import { isHubPortalProtectedPath, prefersHubPortalLoginRedirect } from "./hub-portal-paths.js";

interface HubPortalRequest extends Request {
  user?: { id: string };
  ability?: Ability;
}

/**
 * Enforces CASL on `/hub/*` and `/admin/*` after the session + ability
 * middleware ran. Anonymous requests are already rejected by
 * `BetterAuthSessionMiddleware`; this layer denies authenticated users
 * without `read DevHub` (or `manage all`).
 */
@Injectable()
export class HubPortalMiddleware implements NestMiddleware {
  use(req: HubPortalRequest, res: Response, next: NextFunction): void {
    const path = stripQuery((req.originalUrl ?? req.url ?? "/") as string);
    if (!isHubPortalProtectedPath(path)) {
      next();
      return;
    }

    // Dev-only surfaces (`assertDev()`). In production/staging the controllers
    // 404 themselves — do not 401 here or specs that assert production 404s fail.
    if (serverConfigFromEnv(process.env).env !== "development") {
      next();
      return;
    }

    const acceptHeader = Array.isArray(req.headers.accept)
      ? req.headers.accept[0]
      : req.headers.accept;

    const devHubAllowed = canAccessDevHub(req.ability);

    if (!req.user?.id) {
      if (devHubAllowed) {
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

    if (!devHubAllowed) {
      if (
        prefersHubPortalLoginRedirect({
          path,
          method: req.method,
          acceptHeader,
        })
      ) {
        res.redirect(302, "/?access=devhub");
        return;
      }
      throw new ForbiddenException("DevHub access required.");
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
