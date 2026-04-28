import { sanitizeFtsQuery } from './fts-query.js';

/**
 * Cross-Resource Search Service (PLAN.md §11 + §32 Phase 5).
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
  search(query: string, limit: number): Promise<SearchHit[]>;
}

export interface SearchOptions {
  limit: number;
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

    const batches = await Promise.all(active.map((e) => e.search(sanitized, options.limit)));
    const all = batches.flat();
    all.sort((a, b) => b.rank - a.rank);
    return all.slice(0, options.limit);
  }
}
