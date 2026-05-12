import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import type { ResourceSearchExecutor, SearchHit } from "./cross-resource-search.js";
import { toTsquery } from "./fts-query.js";

/**
 * Default User search executor (CF.SEARCH.* — iter-101).
 *
 * Postgres FTS over `users.email + users.name` with `ts_rank` ordering
 * and `ts_headline` highlighting. Matches a tsquery built from the
 * sanitised user input via `toTsquery()`. Returns canonical
 * `SearchHit` rows the cross-resource service aggregates.
 *
 * Why a separate planner (`buildUserSearchSql`): the SQL string is the
 * load-bearing piece (table layout, ts_headline config). Keeping it
 * pure makes test asserts trivially-stable — the runner is just
 * `prisma.$queryRawUnsafe(planner_output, tsquery, limit)`.
 */

export interface BuildUserSearchSqlInput {
  readonly limit: number;
}

export function buildUserSearchSql(input: BuildUserSearchSqlInput): string {
  // The `simple` config skips stemming so tests can predict matches
  // without language-specific snowball lemmatisation. ts_headline
  // wraps every match with `<b>...</b>` (the renderer's trust
  // boundary documented in src/core/dx/CLAUDE.md).
  // Static SQL — only the tsquery + limit are parameterised.
  void input;
  return `
    SELECT
      id,
      ts_rank(
        to_tsvector('simple', coalesce(email, '') || ' ' || coalesce(name, '')),
        to_tsquery('simple', $1)
      ) AS rank,
      ts_headline(
        'simple',
        coalesce(email, '') || ' ' || coalesce(name, ''),
        to_tsquery('simple', $1),
        'StartSel=<b>, StopSel=</b>, MaxWords=20, MinWords=1'
      ) AS highlight
    FROM users
    WHERE to_tsvector('simple', coalesce(email, '') || ' ' || coalesce(name, ''))
          @@ to_tsquery('simple', $1)
    ORDER BY rank DESC
    LIMIT $2
  `;
}

/**
 * Escape a raw string so it is safe to embed in HTML.
 * The standard 5-character table: & < > " '
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitise a `ts_headline` output string for safe HTML rendering.
 *
 * Strategy:
 *   1. HTML-escape the entire string (neutralises user-controlled content).
 *   2. Un-escape ONLY the `<b>` / `</b>` pairs that `ts_headline` inserts
 *      as highlight markers, leaving every other character entity intact.
 *
 * This preserves the bold-highlight visual while preventing stored XSS
 * in any renderer that trusts the highlight string (M2 fix).
 */
export function sanitizeHighlight(raw: string): string {
  const escaped = escapeHtml(raw);
  return escaped.replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
}

@Injectable()
export class PrismaUserSearchExecutor implements ResourceSearchExecutor {
  readonly table = "users";

  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const tsquery = toTsquery(query);
    const sql = buildUserSearchSql({ limit });
    const rows = (await this.prisma.$queryRawUnsafe(sql, tsquery, limit)) as Array<{
      id: string;
      rank: number;
      highlight: string;
    }>;
    return rows.map(
      (row): SearchHit => ({
        resource: "users",
        id: row.id,
        rank: typeof row.rank === "number" ? row.rank : Number.parseFloat(String(row.rank)),
        // Sanitise the ts_headline output before it reaches any renderer.
        // `ts_headline` wraps match tokens in `<b>…</b>` — those tags are the
        // ONLY HTML we want to pass through. All other characters (including
        // user-controlled email / name content) are escaped to prevent stored
        // XSS in the dev-hub Search Tester (M2 fix).
        highlight: sanitizeHighlight(row.highlight),
      }),
    );
  }
}
