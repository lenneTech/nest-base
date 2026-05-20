import { BadRequestException, Controller, Get, Query, Req } from "@nestjs/common";
import type { Request } from "express";

import { Can } from "../permissions/can.guard.js";
import { getCurrentTenantId } from "../multi-tenancy/tenant-context.js";
import { type SearchHit } from "./cross-resource-search.js";
import { SearchService } from "./search.service.js";

interface AuthenticatedRequest extends Request {
  user?: { activeOrganizationId?: string | null };
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * `GET /search?q=…&limit=…&only=table1,table2`
 *
 * Cross-resource full-text search. Sanitises the query via
 * `sanitizeFtsQuery()`, fans it out to every registered resource
 * executor, sorts by `ts_rank` descending. With no executors
 * registered (current default), returns an empty array.
 *
 * MAJ-4 fix: tenant scope is required so executors cannot leak
 * cross-tenant PII. App clients use session `set-active`; operators
 * use the same session `set-active` tenant as `/api/*` (see TenantInterceptor).
 */
@Controller("search")
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Can("read", "Search")
  @Get()
  async search(
    @Req() req: AuthenticatedRequest,
    @Query("q") q: string | undefined,
    @Query("limit") limit: string | undefined,
    @Query("only") only: string | undefined,
  ): Promise<{ hits: SearchHit[]; total: number }> {
    if (!q || q.trim() === "") {
      throw new BadRequestException("query parameter `q` is required");
    }
    const parsedLimit = limit ? Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT) : DEFAULT_LIMIT;
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException("limit must be a positive integer");
    }
    // Tenant scope comes from session `set-active` (TenantInterceptor ALS).
    const tenantId = getCurrentTenantId() ?? req.user?.activeOrganizationId ?? null;
    if (!tenantId) {
      throw new BadRequestException("tenant context is required");
    }
    const tables = only
      ? only
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const hits = await this.service.search(q, {
      limit: parsedLimit,
      tenantId,
      ...(tables && tables.length > 0 ? { only: tables } : {}),
    });
    return { hits, total: hits.length };
  }
}
