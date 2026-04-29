import { BadRequestException, Controller, Get, Query } from "@nestjs/common";

import { Can } from "../permissions/can.guard.js";
import { type SearchHit } from "./cross-resource-search.js";
import { SearchService } from "./search.service.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * `GET /search?q=…&limit=…&only=table1,table2`
 *
 * Cross-resource full-text search. Sanitises the query via
 * `sanitizeFtsQuery()`, fans it out to every registered resource
 * executor, sorts by `ts_rank` descending. With no executors
 * registered (current default), returns an empty array.
 */
@Controller("search")
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Can("read", "Search")
  @Get()
  async search(
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
    const tables = only
      ? only
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const hits = await this.service.search(q, {
      limit: parsedLimit,
      ...(tables && tables.length > 0 ? { only: tables } : {}),
    });
    return { hits, total: hits.length };
  }
}
