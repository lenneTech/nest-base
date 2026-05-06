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
        highlight: row.highlight,
      }),
    );
  }
}
