import { Body, Controller, HttpCode, Post, Res, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";

import { Public } from "../permissions/public.decorator.js";
import { buildHubAuthConfig } from "./hub-auth-planner.js";
import { HubPasswordService } from "./hub-password.service.js";
import { HubSessionService } from "./hub-session.service.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import type { AppEnv } from "../http/cookie-cors-config.js";

const HUB_COOKIE_NAME = "hub.session";

/**
 * Maps NestJS AppEnv to HubStage (mirrors hub-password.service.ts).
 * Duplicated intentionally to keep the controller self-contained —
 * the password service is the canonical user of this mapping.
 */
function envToHubStage(env: AppEnv | "test"): "local" | "staging" | "production" | "test" {
  if (env === "development") return "local";
  if (env === "production") return "production";
  if (env === "test") return "test";
  return "staging";
}

/**
 * HubController — Hub login and logout endpoints.
 *
 * NOTE: `GET /` (the Hub SPA shell) is NOT served here. It is handled
 * by an Express route registered directly in bootstrap.ts before
 * app.init(). This sidesteps the NestJS global-prefix exclude-list
 * collision between HubController and AppController (both use
 * `@Controller()` with an empty base path that normalises to `/`).
 *
 * POST /hub/login  → password login; sets session cookie on success
 * POST /hub/logout → invalidate session (clears cookie)
 *
 * The login / logout routes are under `/hub/` (not `/api/`) so they
 * stay outside the global `/api/` prefix and are hub-specific paths
 * the SPA can call without tenant headers.
 */
@Controller()
export class HubController {
  constructor(
    private readonly passwords: HubPasswordService,
    private readonly sessions: HubSessionService,
  ) {}

  /**
   * POST /hub/login — password login.
   *
   * Body: `{ password: string }`
   *
   * On success: sets HTTP-only session cookie + returns `{ ok: true }`.
   * On failure: 401 Unauthorized.
   *
   * Always available (public), but on local stage auth is never
   * required so operators will never reach this endpoint in practice.
   */
  @Post("hub/login")
  @HttpCode(200)
  @Public("Hub login endpoint — verifies the Hub password and issues a session cookie")
  async login(@Body() body: { password?: unknown }, @Res() res: Response): Promise<void> {
    const candidate = typeof body?.password === "string" ? body.password : "";
    if (!candidate) {
      throw new UnauthorizedException("password required");
    }

    const valid = await this.passwords.verifyPassword(candidate);
    if (!valid) {
      throw new UnauthorizedException("invalid password");
    }

    const session = this.sessions.createSession();
    const cfg = serverConfigFromEnv(process.env);
    const stage = envToHubStage(cfg.env);
    const authCfg = buildHubAuthConfig({ stage });

    setHubSessionCookie(res, session.token, authCfg.cookie.maxAgeMs);
    res.json({ ok: true });
  }

  /**
   * POST /hub/logout — invalidate session.
   *
   * Clears the Hub session cookie. Server-side there is no revocation
   * list (tokens are stateless) — clearing the cookie is sufficient
   * because the SPA won't send the token again after this response.
   */
  @Post("hub/logout")
  @HttpCode(200)
  @Public("Hub logout — clears the session cookie; no auth required to call")
  logout(@Res() res: Response): void {
    res.clearCookie(HUB_COOKIE_NAME, {
      httpOnly: true,
      path: "/",
    });
    res.json({ ok: true });
  }
}

function setHubSessionCookie(res: Response, token: string, maxAgeMs: number): void {
  // Mirror bootstrap.ts: secure in any environment except development/test
  // so staging deployments (behind HTTPS) also receive the secure flag.
  // Operators can override by setting HUB_COOKIE_SECURE=false.
  const isSecure =
    process.env.HUB_COOKIE_SECURE !== "false" && process.env.NODE_ENV !== "development";
  res.cookie(HUB_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: maxAgeMs,
    path: "/",
  });
}
