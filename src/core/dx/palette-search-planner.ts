/**
 * Pure planner for the Cmd+K command palette page search (Issue #90).
 *
 * Accepts a list of registered Hub pages and a freeform query string,
 * returning a ranked, capped list of matching pages. No I/O, no
 * side-effects — the thin runner in `hub.controller.ts` is the
 * only caller that touches the network.
 *
 * Ranking (highest score → lowest):
 *   exact     — query === title or alias (case-insensitive)
 *   prefix    — title/alias starts with the query
 *   substring — title/alias contains the query
 *   fuzzy     — Levenshtein distance ≤ 1 between query and any word
 */

export interface PalettePageEntry {
  id: string;
  title: string;
  href: string;
  /** Extra keywords ("protocols" aliases "Logs"). */
  aliases: string[];
  category: string;
}

export interface PaletteSearchInput {
  query: string;
  pages: readonly PalettePageEntry[];
  /** Defaults to 30. */
  maxResults?: number;
}

export type PaletteMatchType = "exact" | "prefix" | "substring" | "fuzzy";

export interface PaletteSearchResult {
  id: string;
  title: string;
  href: string;
  score: number;
  matchType: PaletteMatchType;
  category: string;
}

// Score constants — kept large enough that no combination of lower-tier
// scores can eclipse a higher-tier match.
const SCORE_EXACT = 1000;
const SCORE_PREFIX = 100;
const SCORE_SUBSTRING = 10;
const SCORE_FUZZY = 1;

/**
 * Optimal String Alignment distance (a.k.a. restricted edit distance).
 * Like Levenshtein but also counts adjacent transpositions as one edit.
 * This lets "Lgos" match "logs" (one transposition: l-g-o → l-o-g).
 *
 * Bounded at 2 for performance — we only care whether the distance is
 * 0, 1, or ≥ 2.
 */
function editDistance(a: string, b: string): number {
  // Fast exits
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const maxDist = 2;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;

  // d[i][j] = OSA distance between a[0..i-1] and b[0..j-1]
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= a.length; i++) {
    let rowMin = d[i]![0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1, // deletion
        d[i]![j - 1]! + 1, // insertion
        d[i - 1]![j - 1]! + cost, // substitution
      );
      // Transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
      if (d[i]![j]! < rowMin) rowMin = d[i]![j]!;
    }
    // Early exit when the whole row is beyond our cap
    if (rowMin > maxDist) return maxDist + 1;
  }
  return d[a.length]![b.length]!;
}

/**
 * Score a single candidate string (title or alias) against the query.
 * Returns `{ score, matchType }` where score === 0 means no match.
 */
function scoreCandidate(
  candidate: string,
  query: string,
): { score: number; matchType: PaletteMatchType } | null {
  const c = candidate.toLowerCase();
  const q = query.toLowerCase();

  if (c === q) return { score: SCORE_EXACT, matchType: "exact" };
  if (c.startsWith(q)) return { score: SCORE_PREFIX, matchType: "prefix" };
  if (c.includes(q)) return { score: SCORE_SUBSTRING, matchType: "substring" };

  // Fuzzy: check each word in the candidate against the full query
  // (query length ≤ word length + 2 guard avoids spurious matches on
  // very short queries like "a").
  const words = c.split(/\s+/);
  for (const word of words) {
    if (Math.abs(word.length - q.length) <= 1 && editDistance(word, q) === 1) {
      return { score: SCORE_FUZZY, matchType: "fuzzy" };
    }
  }

  return null;
}

/**
 * Score a page entry against a query, considering both title and aliases.
 * Returns the best (highest-score) match found.
 */
function scorePage(
  page: PalettePageEntry,
  query: string,
): { score: number; matchType: PaletteMatchType } | null {
  const candidates = [page.title, ...page.aliases];
  let best: { score: number; matchType: PaletteMatchType } | null = null;
  for (const candidate of candidates) {
    const result = scoreCandidate(candidate, query);
    if (result && (!best || result.score > best.score)) {
      best = result;
    }
  }
  return best;
}

/**
 * Search registered palette pages by `input.query`.
 *
 * - Empty query → all pages sorted by title.
 * - Non-empty → ranked by score (exact > prefix > substring > fuzzy).
 *   Pages that don't match at all are excluded.
 * - Output is capped at `input.maxResults` (default 30).
 */
export function searchPalettePages(input: PaletteSearchInput): PaletteSearchResult[] {
  const { query, pages, maxResults = 30 } = input;

  if (!query.trim()) {
    // Empty query: return everything sorted by title
    return [...pages]
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, maxResults)
      .map((p) => ({
        id: p.id,
        title: p.title,
        href: p.href,
        // Use SCORE_SUBSTRING as a neutral "present" score so the UI
        // can treat empty-query results uniformly without special-casing.
        score: SCORE_SUBSTRING,
        matchType: "substring" as PaletteMatchType,
        category: p.category,
      }));
  }

  const scored: PaletteSearchResult[] = [];
  for (const page of pages) {
    const match = scorePage(page, query);
    if (!match) continue;
    scored.push({
      id: page.id,
      title: page.title,
      href: page.href,
      score: match.score,
      matchType: match.matchType,
      category: page.category,
    });
  }

  // Primary sort: score descending. Ties: title ascending.
  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return scored.slice(0, maxResults);
}
