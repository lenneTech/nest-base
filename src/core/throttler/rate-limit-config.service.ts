/**
 * RateLimitConfigService — live-editable rate-limit window store (issue #94).
 *
 * Loads all `RateLimitConfig` rows from Postgres on module init, caches them
 * in memory, and refreshes every 30 seconds so operators can adjust limits
 * without a code deploy. DB rows override the hardcoded defaults in
 * `rate-limit-config-planner.ts`; deleting a row resets that scope to its
 * default.
 *
 * Thread-safety: a single Node.js event loop means no concurrent mutation,
 * but we do an atomic cache-pointer swap on each refresh so an in-flight
 * `getWindow()` call always sees a consistent snapshot.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import {
  buildDefaultScopeMap,
  validateRateLimitConfig,
  type ScopeWindow,
} from "./rate-limit-config-planner.js";

const REFRESH_INTERVAL_MS = 30_000;

@Injectable()
export class RateLimitConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitConfigService.name);
  private cache: Map<string, ScopeWindow> = new Map();
  private readonly defaults: Map<string, ScopeWindow> = buildDefaultScopeMap();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    // Periodic refresh so live edits are picked up within 30 s
    // without requiring a process restart.
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch((err: unknown) => {
        this.logger.warn({ err }, "rate-limit config refresh failed — keeping stale cache");
      });
    }, REFRESH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Return the effective window for `scope`. DB row wins over the
   * hardcoded default; if neither exists, falls back to a permissive
   * sentinel (10 000 req / 60 s) so unrecognised scopes never hard-block.
   */
  getWindow(scope: string): ScopeWindow {
    return (
      this.cache.get(scope) ??
      this.defaults.get(scope) ?? { maxRequests: 10_000, windowSeconds: 60 }
    );
  }

  /**
   * Persist an updated window for `scope`, then refresh the in-memory
   * cache so the change is immediately visible to the next request.
   */
  async setWindow(
    scope: string,
    maxRequests: number,
    windowSeconds: number,
    updatedById?: string,
  ): Promise<void> {
    const validation = validateRateLimitConfig({ maxRequests, windowSeconds });
    if (!validation.ok) {
      throw new Error(`rate-limit-config: invalid config — ${validation.error}`);
    }
    await this.prisma.rateLimitConfig.upsert({
      where: { scope },
      create: { scope, maxRequests, windowSeconds, updatedById },
      update: { maxRequests, windowSeconds, updatedById },
    });
    await this.refresh();
  }

  /**
   * Delete the operator override for `scope`, falling the effective
   * window back to the hardcoded default. Idempotent: if no row
   * exists for the scope, the operation still succeeds.
   */
  async deleteWindow(scope: string): Promise<void> {
    await this.prisma.rateLimitConfig.deleteMany({ where: { scope } });
    await this.refresh();
  }

  /**
   * Return all configured scopes (DB rows only, not defaults).
   */
  async listConfigured(): Promise<
    Array<{
      id: string;
      scope: string;
      maxRequests: number;
      windowSeconds: number;
      updatedAt: Date;
    }>
  > {
    return this.prisma.rateLimitConfig.findMany({
      orderBy: { scope: "asc" },
      select: { id: true, scope: true, maxRequests: true, windowSeconds: true, updatedAt: true },
    });
  }

  private async refresh(): Promise<void> {
    const rows = await this.prisma.rateLimitConfig.findMany({
      select: { scope: true, maxRequests: true, windowSeconds: true },
    });
    const next = new Map<string, ScopeWindow>();
    for (const row of rows) {
      next.set(row.scope, { maxRequests: row.maxRequests, windowSeconds: row.windowSeconds });
    }
    // Atomic pointer swap — in-flight getWindow() calls see either the
    // old or the new map, never a partially-built one.
    this.cache = next;
  }
}
