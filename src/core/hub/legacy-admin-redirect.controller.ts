import { All, Controller, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request, Response } from "express";

import { Public } from "../permissions/public.decorator.js";

/**
 * Legacy `/admin/*` → `/hub/admin/*` bridge (api-stability-promise).
 *
 * The Hub consolidation moved every admin portal surface under the one
 * `/hub` namespace. This controller keeps the old URLs answering with a
 * `308 Permanent Redirect` to the successor path — 308 (not 301/302)
 * because clients must re-play non-GET methods and bodies against the
 * new location instead of downgrading to GET.
 *
 * Deliberately ONE catch-all, not per-route stubs: the mapping is pure
 * string surgery (`/admin…` → `/hub/admin…`, query preserved), and the
 * target route re-applies whatever gate the old route had (tier guard,
 * `@Can` ability, feature flag). No availability check here — a 404
 * from a moved-but-unavailable surface must come from the SAME place it
 * came from before the move.
 *
 * NOT a new anonymous surface: `hub-portal-paths.ts` still classifies
 * `/admin/*` as a tenant-admin portal path, so the Better-Auth session
 * middleware and `HubPortalMiddleware` answer first. Anonymous browsers
 * get the login redirect, anonymous JSON gets 401, and outside
 * development with `FEATURE_HUB_ENABLED=true` unauthorized sessions get
 * the same masked 404 as every other portal path. Only requests that
 * pass the wall ever see the 308.
 *
 * `@Public`: route-audit classification only — the middleware wall above
 * is the actual gate, mirroring the `@Public` shells it replaced.
 * `@ApiExcludeController`: the legacy namespace must not resurface in
 * the OpenAPI document next to its `/hub/admin/*` successors.
 *
 * Deprecation window: keep for at least two minor releases; removal is
 * planned for the next major (see PR body / ledger).
 */
@ApiExcludeController()
@Controller("admin")
@Public(
  "Legacy /admin redirect bridge — session + CASL wall answers first (HubPortalMiddleware); the /hub/admin target re-applies every gate.",
)
export class LegacyAdminRedirectController {
  @All()
  redirectBase(@Req() req: Request, @Res() res: Response): void {
    redirectToHubAdmin(req, res);
  }

  @All("*splat")
  redirectDeep(@Req() req: Request, @Res() res: Response): void {
    redirectToHubAdmin(req, res);
  }
}

/** `/admin<rest>?<query>` → `308 /hub/admin<rest>?<query>`. */
function redirectToHubAdmin(req: Request, res: Response): void {
  const original = req.originalUrl ?? req.url ?? "/admin";
  res.redirect(308, `/hub${original}`);
}
