/**
 * Search-Tester UI renderer (PLAN.md §27.1 + §32 Phase 8).
 *
 * Pure HTML for the `/admin/search` page. The controller runs the
 * FTS query through CrossResourceSearchService (or a single-
 * resource search), feeds the result list and parsed tsquery
 * diagnostic into this renderer.
 *
 * Snippet highlights from postgres' `ts_headline` arrive
 * pre-wrapped in `<b>…</b>`; the renderer treats those as trusted
 * and embeds them verbatim. Every other user-controlled field
 * (query, resource, id, title) runs through the standard escape
 * table.
 */

import { renderAdminLayout } from "./admin-layout.js";

export interface SearchHit {
  resource: string;
  id: string;
  title: string;
  /** ts_headline output — trusted, contains `<b>` markers. */
  snippet: string;
  rank: number;
}

export interface SearchTesterPageInput {
  /** What the admin typed (echoed back into the input). */
  query?: string;
  /** Postgres tsquery the FTS layer parsed (shown as a debug hint). */
  tsquery?: string;
  hits: SearchHit[];
}

export function renderSearchTesterPage(input: SearchTesterPageInput): string {
  const body = `
<style>
  td.snippet b { background: rgba(210, 153, 34, .25); color: var(--warning); font-weight: 600; padding: 0 .15em; border-radius: 2px; }
  td.rank { font-variant-numeric: tabular-nums; color: var(--text-muted); }
  pre.tsquery { background: var(--code-bg); padding: .55rem .75rem; border-radius: 4px; margin: 0; }
</style>
<div class="admin-card">
  <h2 class="admin-card__title">Query</h2>
  ${renderForm(input.query)}
</div>
${renderTsqueryHint(input.tsquery)}
<div class="admin-card">
  <h2 class="admin-card__title">Results</h2>
  ${renderResults(input)}
</div>`;
  return renderAdminLayout({
    title: "Search Tester",
    subtitle: "Cross-resource full-text search with parsed tsquery diagnostics.",
    currentNav: "search",
    body,
  });
}

function renderForm(query: string | undefined): string {
  const safeQuery = escapeHtml(query ?? "");
  return `<form class="admin-form q" method="get">
  <div class="row" style="grid-template-columns: 1fr auto;">
    <label>Query
      <input name="q" value="${safeQuery}" placeholder="Type a search query and press Enter…" autofocus>
    </label>
    <button type="submit">Search</button>
  </div>
</form>`;
}

function renderTsqueryHint(tsquery: string | undefined): string {
  if (!tsquery) return "";
  return `<div class="admin-card" data-tsquery="true">
    <h2 class="admin-card__title">Parsed tsquery</h2>
    <pre class="tsquery">${escapeHtml(tsquery)}</pre>
  </div>`;
}

function renderResults(input: SearchTesterPageInput): string {
  if (input.query === undefined) {
    return `<div class="admin-empty">Enter a query above to start searching.</div>`;
  }
  if (input.hits.length === 0) {
    return `<div class="admin-empty">No results for "<strong>${escapeHtml(input.query)}</strong>".</div>`;
  }
  const rows = input.hits.map(renderHitRow).join("");
  return `<p class="admin-meta">${input.hits.length} result${input.hits.length === 1 ? "" : "s"}.</p>
<table class="admin-table" data-search-results="true">
<thead><tr><th>Resource</th><th>Title</th><th>Snippet</th><th>Rank</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function renderHitRow(hit: SearchHit): string {
  return `<tr data-resource="${escapeHtml(hit.resource)}">
<td><strong>${escapeHtml(hit.resource)}</strong><br><small>${escapeHtml(hit.id)}</small></td>
<td>${escapeHtml(hit.title)}</td>
<td class="snippet">${hit.snippet}</td>
<td class="rank">${hit.rank.toFixed(2)}</td>
</tr>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
