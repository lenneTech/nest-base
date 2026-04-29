import { All, Controller, Inject, Req, Res } from "@nestjs/common";
import { toNodeHandler } from "better-auth/node";
import type { Request, Response } from "express";

import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from "./better-auth.token.js";

/**
 * Mounts Better-Auth's handler under `/api/auth/*`. The catch-all
 * route delegates the raw `req` / `res` to Better-Auth's Node-style
 * handler, which serves sign-up / sign-in / get-session / 2FA /
 * passkey / OAuth endpoints based on the configured plugins.
 *
 * The handler reads the request body itself; using `@Res()` puts
 * NestJS into passthrough mode so it doesn't double-respond.
 *
 * If `BETTER_AUTH_SECRET` is not configured the injected instance is
 * `null` and every auth request returns `503 Service Unavailable`.
 */
@Controller("api/auth")
export class BetterAuthController {
  constructor(@Inject(BETTER_AUTH_INSTANCE) private readonly auth: BetterAuthInstance | null) {}

  @All("*splat")
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.auth) {
      res.status(503).json({
        error: "auth-not-configured",
        message: "BETTER_AUTH_SECRET is not set; /api/auth/* is disabled.",
      });
      return;
    }
    const handler = toNodeHandler(this.auth);
    await handler(req, res);
  }
}
