/**
 * RateLimitAdminController — `/admin/rate-limits` Hub section (issue #94).
 *
 * Exposes live throttle state, operator-editable config windows, sampled
 * decision history, manual unblock actions, and an IP/user allowlist —
 * all without a code deploy.
 *
 * RBAC: every JSON / action route is gated with `@Can("manage", "RateLimitAdmin")`.
 *       The SPA shell is `@Public(...)` because the React bundle loads the
 *       page skeleton and the individual JSON fetches carry the gate.
 *
 * Tier: OPERATIONAL, without a surface guard — this controller was never
 * dev-asserted: the CASL `manage:RateLimitAdmin` gate blocks non-admin
 * users in every environment (pre-existing production behaviour, kept
 * for backward compatibility). When `FEATURE_HUB_ENABLED=true`,
 * `HubPortalMiddleware` additionally walls the whole `/admin/*` prefix
 * behind `canAccessTenantAdmin`.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";

import { buildDevPortalShellInput, renderDevPortalShell } from "../dx/dev-portal-shell.js";
import { Can } from "../permissions/can.guard.js";
import { Public } from "../permissions/public.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RateLimitConfigService } from "./rate-limit-config.service.js";
import {
  listActiveThrottlerRecords,
  resetThrottlerByEndpointPrefix,
  resetThrottlerKey,
} from "./throttler-postgres-backend.js";
import { buildDefaultScopeMap, validateRateLimitConfig } from "./rate-limit-config-planner.js";

@Controller("admin/rate-limits")
export class RateLimitAdminController {
  constructor(
    private readonly configService: RateLimitConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── SPA shell ────────────────────────────────────────────────────────────

  /**
   * `GET /admin/rate-limits` — React SPA shell that hosts the Rate-Limits
   * admin section. Interactive payloads use the gated JSON endpoints below;
   * the shell itself is public so the browser can load the React bundle.
   */
  @Public(
    "Dev-Hub admin SPA shell — served only in dev mode; operator CASL gate applies to all data endpoints",
  )
  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  rateLimitsPage(): string {
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Rate-Limits Admin", brand: "central" }),
    );
  }

  // ─── Inspector ────────────────────────────────────────────────────────────

  /**
   * `GET /admin/rate-limits/inspector.json`
   * Live throttler records (non-expired rows from `throttler_records`).
   * Optional query params: `scope` (endpoint filter), `limit` (max rows, default 100).
   */
  @Can("manage", "RateLimitAdmin")
  @Get("inspector.json")
  async inspectorJson(
    @Query("scope") scope?: string,
    @Query("limit") limitStr?: string,
  ): Promise<{
    rows: Array<{ key: string; count: number; expiresAt: string; expiresInSeconds: number }>;
    total: number;
  }> {
    const limit = Math.min(Number(limitStr ?? "100") || 100, 500);
    const now = new Date();
    const { rows, total } = await listActiveThrottlerRecords(this.prisma, { now, limit });
    return {
      rows: rows
        .filter((r) => !scope || r.key.includes(scope))
        .map((r) => ({
          key: r.key,
          count: r.count,
          expiresAt: r.expiresAt.toISOString(),
          expiresInSeconds: Math.max(0, Math.floor((r.expiresAt.getTime() - now.getTime()) / 1000)),
        })),
      total,
    };
  }

  // ─── Config ───────────────────────────────────────────────────────────────

  /**
   * `GET /admin/rate-limits/config.json`
   * All 7 scopes with the currently effective window (DB row or default).
   */
  @Can("manage", "RateLimitAdmin")
  @Get("config.json")
  async configJson(): Promise<{
    scopes: Array<{
      scope: string;
      maxRequests: number;
      windowSeconds: number;
      isCustom: boolean;
    }>;
  }> {
    const configured = await this.configService.listConfigured();
    const configuredScopes = new Set(configured.map((c) => c.scope));
    const defaults = buildDefaultScopeMap();

    const scopes = Array.from(defaults.keys()).map((scope) => {
      const effective = this.configService.getWindow(scope);
      return {
        scope,
        maxRequests: effective.maxRequests,
        windowSeconds: effective.windowSeconds,
        isCustom: configuredScopes.has(scope),
      };
    });

    return { scopes };
  }

  /**
   * `PUT /admin/rate-limits/config/:scope`
   * Save (upsert) an operator override for one scope.
   * Body: `{ maxRequests: number; windowSeconds: number }`.
   */
  @Can("manage", "RateLimitAdmin")
  @Put("config/:scope")
  async putConfig(
    @Param("scope") scope: string,
    @Body() body: { maxRequests?: unknown; windowSeconds?: unknown },
  ): Promise<{ scope: string; maxRequests: number; windowSeconds: number }> {
    const maxRequests = Number(body.maxRequests);
    const windowSeconds = Number(body.windowSeconds);

    if (!Number.isInteger(maxRequests) || !Number.isInteger(windowSeconds)) {
      throw new BadRequestException("maxRequests and windowSeconds must be integers");
    }

    const validation = validateRateLimitConfig({ maxRequests, windowSeconds });
    if (!validation.ok) {
      throw new BadRequestException(validation.error);
    }

    await this.configService.setWindow(scope, maxRequests, windowSeconds);
    return { scope, maxRequests, windowSeconds };
  }

  /**
   * `DELETE /admin/rate-limits/config/:scope`
   * Reset a scope to its hardcoded default by removing the DB override row.
   */
  @Can("manage", "RateLimitAdmin")
  @Delete("config/:scope")
  async deleteConfig(@Param("scope") scope: string): Promise<{ scope: string; reset: true }> {
    await this.configService.deleteWindow(scope);
    return { scope, reset: true };
  }

  // ─── Decision history ─────────────────────────────────────────────────────

  /**
   * `GET /admin/rate-limits/decisions.json`
   * Sampled decision history with optional pagination.
   * Query params: `cursor` (ISO date, exclusive upper bound), `limit`, `endpoint`, `decision`.
   */
  @Can("manage", "RateLimitAdmin")
  @Get("decisions.json")
  async decisionsJson(
    @Query("cursor") cursor?: string,
    @Query("limit") limitStr?: string,
    @Query("endpoint") endpoint?: string,
    @Query("decision") decision?: string,
  ): Promise<{
    items: Array<{
      id: string;
      bucketKey: string;
      endpoint: string;
      decision: string;
      count: number;
      limit: number;
      windowSecs: number;
      ip: string | null;
      userId: string | null;
      ts: string;
    }>;
    nextCursor: string | null;
    total: number;
  }> {
    const limit = Math.min(Number(limitStr ?? "50") || 50, 200);

    const whereConditions: Record<string, unknown> = {};
    if (endpoint) whereConditions.endpoint = endpoint;
    if (decision === "allow" || decision === "block") whereConditions.decision = decision;
    if (cursor) whereConditions.ts = { lt: new Date(cursor) };

    const [items, total] = await Promise.all([
      this.prisma.rateLimitDecision.findMany({
        where: whereConditions,
        orderBy: { ts: "desc" },
        take: limit + 1,
        select: {
          id: true,
          bucketKey: true,
          endpoint: true,
          decision: true,
          count: true,
          limit: true,
          windowSecs: true,
          ip: true,
          userId: true,
          ts: true,
        },
      }),
      this.prisma.rateLimitDecision.count({ where: whereConditions }),
    ]);

    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    const nextCursor = hasMore ? (page[page.length - 1]?.ts.toISOString() ?? null) : null;

    return {
      items: page.map((r) => ({
        ...r,
        ts: r.ts.toISOString(),
      })),
      nextCursor,
      total,
    };
  }

  // ─── Key reset (manual unblock) ──────────────────────────────────────────

  /**
   * `POST /admin/rate-limits/keys/:key/reset`
   * Delete a specific throttler row so the bucket is immediately unblocked.
   */
  @Can("manage", "RateLimitAdmin")
  @Post("keys/:key/reset")
  async resetKey(@Param("key") key: string): Promise<{ key: string; reset: boolean }> {
    const reset = await resetThrottlerKey(this.prisma, key);
    return { key, reset };
  }

  /**
   * `POST /admin/rate-limits/endpoints/:name/reset-all`
   * Bulk-delete all throttler rows whose key starts with `name`.
   */
  @Can("manage", "RateLimitAdmin")
  @Post("endpoints/:name/reset-all")
  async resetEndpointAll(
    @Param("name") name: string,
  ): Promise<{ prefix: string; deleted: number }> {
    const deleted = await resetThrottlerByEndpointPrefix(this.prisma, name);
    return { prefix: name, deleted };
  }

  // ─── Allowlist ────────────────────────────────────────────────────────────

  /**
   * `GET /admin/rate-limits/allowlist.json`
   * All allowlisted users.
   */
  @Can("manage", "RateLimitAdmin")
  @Get("allowlist.json")
  async allowlistJson(): Promise<{
    items: Array<{ id: string; userId: string; reason: string; createdAt: string }>;
  }> {
    const items = await this.prisma.rateLimitAllowlist.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, userId: true, reason: true, createdAt: true },
    });
    return {
      items: items.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    };
  }

  /**
   * `POST /admin/rate-limits/allowlist`
   * Add a user to the allowlist.
   * Body: `{ userId: string; reason: string }`.
   */
  @Can("manage", "RateLimitAdmin")
  @Post("allowlist")
  async addToAllowlist(
    @Body() body: { userId?: unknown; reason?: unknown },
  ): Promise<{ id: string; userId: string; reason: string }> {
    if (typeof body.userId !== "string" || body.userId.trim().length === 0) {
      throw new BadRequestException("userId (non-empty string) is required");
    }
    if (typeof body.reason !== "string" || body.reason.trim().length === 0) {
      throw new BadRequestException("reason (non-empty string) is required");
    }

    const entry = await this.prisma.rateLimitAllowlist.upsert({
      where: { userId: body.userId },
      create: { userId: body.userId, reason: body.reason },
      update: { reason: body.reason },
      select: { id: true, userId: true, reason: true },
    });
    return entry;
  }

  /**
   * `DELETE /admin/rate-limits/allowlist/:userId`
   * Remove a user from the allowlist.
   */
  @Can("manage", "RateLimitAdmin")
  @Delete("allowlist/:userId")
  async removeFromAllowlist(
    @Param("userId") userId: string,
  ): Promise<{ userId: string; removed: boolean }> {
    const result = await this.prisma.rateLimitAllowlist.deleteMany({ where: { userId } });
    return { userId, removed: result.count > 0 };
  }
}
