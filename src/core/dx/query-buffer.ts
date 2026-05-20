/**
 * In-memory query buffer for Prisma `$on('query', …)` events.
 *
 * Same pattern as `log-buffer.ts` and `trace-buffer.ts` — bounded
 * ring buffer surfaced via `/dev/queries` so a developer can see
 * "what queries did my last request fire, and which were slow?"
 * without booting a real APM (Datadog, NewRelic).
 *
 * The "top frequent templates" view doubles as a cheap N+1
 * detector: if the same parametrised template fires 50× in one
 * request, that's almost certainly a missing `include:` causing a
 * round-trip per row.
 *
 * Singleton-friendly (`getQueryBuffer()`) so the PrismaService can
 * push records and the Hub controller can read them. Process-
 * local; cleared on dev-server restart.
 */

export interface QueryRecord {
  sql: string;
  durationMs: number;
  startedAtMs: number;
  /** Optional request-id from the AsyncLocalStorage RequestContext. */
  requestId?: string;
}

export interface QuerySummary {
  total: number;
  slowestMs: number;
  /** Queries > 50 ms — surface as warnings. */
  warnCount: number;
  /** Queries > 200 ms — surface as errors. */
  badCount: number;
}

export interface TemplateGroup {
  template: string;
  count: number;
  totalMs: number;
  /** Sample SQL for the row (most recent occurrence, helpful for debugging). */
  sample: string;
}

export interface QueryFilter {
  limit?: number;
  requestId?: string;
}

const DEFAULT_CAPACITY = 500;
const WARN_THRESHOLD_MS = 50;
const BAD_THRESHOLD_MS = 200;

export class QueryBuffer {
  private readonly capacity: number;
  private readonly buffer: QueryRecord[] = [];

  constructor(options: { capacity?: number } = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
  }

  record(query: QueryRecord): void {
    this.buffer.push(query);
    while (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  recent(filter: QueryFilter = {}): QueryRecord[] {
    let queries = this.buffer.slice();
    if (filter.requestId) {
      queries = queries.filter((q) => q.requestId === filter.requestId);
    }
    if (filter.limit !== undefined && filter.limit < queries.length) {
      queries = queries.slice(queries.length - filter.limit);
    }
    return queries;
  }

  slowest(limit: number): QueryRecord[] {
    return this.buffer
      .slice()
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, limit);
  }

  topTemplates(limit: number): TemplateGroup[] {
    const groups = new Map<string, TemplateGroup>();
    for (const q of this.buffer) {
      const template = normaliseSql(q.sql);
      const existing = groups.get(template);
      if (existing) {
        existing.count += 1;
        existing.totalMs += q.durationMs;
        existing.sample = q.sql;
      } else {
        groups.set(template, {
          template,
          count: 1,
          totalMs: q.durationMs,
          sample: q.sql,
        });
      }
    }
    return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  }

  summary(): QuerySummary {
    let slowestMs = 0;
    let warnCount = 0;
    let badCount = 0;
    for (const q of this.buffer) {
      if (q.durationMs > slowestMs) slowestMs = q.durationMs;
      if (q.durationMs > BAD_THRESHOLD_MS) badCount += 1;
      else if (q.durationMs > WARN_THRESHOLD_MS) warnCount += 1;
    }
    return { total: this.buffer.length, slowestMs, warnCount, badCount };
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

/**
 * Reduce a SQL string to a "template" — strip literals and collapse
 * whitespace so `... id = 42` and `... id = 99` group together.
 * Parametrised placeholders (`$1`) are preserved as-is.
 */
export function normaliseSql(sql: string): string {
  return (
    sql
      // Single-quoted string literals (handles escaped doubled quotes).
      .replace(/'(?:[^']|'')*'/g, "'?'")
      // Numeric literals (avoid touching $1, $2 — those have a $ prefix).
      .replace(/(?<![\w$])\d+(\.\d+)?\b/g, "?")
      // Collapse whitespace runs.
      .replace(/\s+/g, " ")
      .trim()
  );
}

let singleton: QueryBuffer | null = null;

export function getQueryBuffer(): QueryBuffer {
  if (!singleton) singleton = new QueryBuffer();
  return singleton;
}

/** Test-only reset (jest/vitest beforeEach). */
export function resetQueryBufferForTests(): void {
  singleton = null;
}

export { WARN_THRESHOLD_MS, BAD_THRESHOLD_MS };
