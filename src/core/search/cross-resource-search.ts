import { sanitizeFtsQuery } from "./fts-query.js";

/**
 * Cross-Resource Search Service.
 *
 * Fans the sanitized query out to every registered resource
 * executor, aggregates hits, sorts by rank descending, trims to the
 * requested limit. The executors are injectable so the unit suite
 * stays DB-free; the production binding wraps Prisma `$queryRaw`
 * calls per resource.
 */

export interface SearchHit {
  resource: string;
  id: string;
  /** Higher = better match. Mirrors Postgres `ts_rank`. */
  rank: number;
  highlight?: string;
}

export interface ResourceSearchExecutor {
  /** Postgres table name; matched against `only` filter. */
  table: string;
  /**
   * Execute the search. `tenantId` is the requesting user's active
   * organization and MUST be used to restrict results to that tenant
   * — returning rows from other tenants is a cross-tenant PII leak
   * (MAJ-4 fix).
   */
  search(query: string, limit: number, tenantId: string): Promise<SearchHit[]>;
}

export interface SearchOptions {
  limit: number;
  /**
   * Active tenant of the requesting user. Executors MUST use this to
   * scope their queries — omitting it would return cross-tenant rows.
   */
  tenantId: string;
  /** When set, restrict the search to this allowlist of resources. */
  only?: readonly string[];
}

export class CrossResourceSearchService {
  constructor(private readonly executors: readonly ResourceSearchExecutor[]) {}

  async search(query: string, options: SearchOptions): Promise<SearchHit[]> {
    if (options.limit <= 0) {
      throw new Error(`cross-resource-search: limit must be positive (received: ${options.limit})`);
    }
    const sanitized = sanitizeFtsQuery(query);

    const allow = options.only ? new Set(options.only) : null;
    const active = this.executors.filter((e) => !allow || allow.has(e.table));

    const batches = await Promise.all(
      active.map((e) => e.search(sanitized, options.limit, options.tenantId)),
    );
    const all = batches.flat();
    all.sort((a, b) => b.rank - a.rank);
    return all.slice(0, options.limit);
  }
}
