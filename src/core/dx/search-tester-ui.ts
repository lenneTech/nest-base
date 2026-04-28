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
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Search Tester</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; max-width: 1000px; color: #1b1b1b; }
  h1 { margin-bottom: 1rem; }
  form.q { display: grid; grid-template-columns: 1fr auto; gap: .5rem; align-items: end; margin-bottom: 1rem; }
  input { padding: .5rem; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; }
  button { padding: .5rem 1rem; background: #1b1b1b; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: .5rem; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
  td.snippet b { background: #fff7d6; font-weight: 600; }
  td.rank { font-variant-numeric: tabular-nums; color: #555; }
  .empty { padding: 1rem; color: #777; }
  .meta { color: #555; font-size: .875rem; margin-bottom: 1rem; }
  pre.tsquery { font-family: ui-monospace, SFMono-Regular, monospace; font-size: .8125rem; background: #f6f6f6; padding: .5rem; border-radius: 4px; margin: 0; }
  a.back { color: #555; text-decoration: none; font-size: .875rem; }
  a.back:hover { text-decoration: underline; }
</style>
</head>
<body>
<a href="/dev" class="back">← Back to Dev Hub</a>
<h1>Search Tester</h1>
${renderForm(input.query)}
${renderTsqueryHint(input.tsquery)}
${renderResults(input)}
</body>
</html>`;
}

function renderForm(query: string | undefined): string {
  const safeQuery = escapeHtml(query ?? '');
  return `<form class="q" method="get">
  <input name="q" value="${safeQuery}" placeholder="Type a search query and press Enter…" autofocus>
  <button type="submit">Search</button>
</form>`;
}

function renderTsqueryHint(tsquery: string | undefined): string {
  if (!tsquery) return '';
  return `<div class="meta" data-tsquery="true">Parsed tsquery: <pre class="tsquery">${escapeHtml(tsquery)}</pre></div>`;
}

function renderResults(input: SearchTesterPageInput): string {
  if (input.query === undefined) {
    return `<div class="empty">Enter a query above to start searching.</div>`;
  }
  if (input.hits.length === 0) {
    return `<div class="empty">No results for "<strong>${escapeHtml(input.query)}</strong>".</div>`;
  }
  const rows = input.hits.map(renderHitRow).join('');
  return `<p class="meta">${input.hits.length} result${input.hits.length === 1 ? '' : 's'}.</p>
<table data-search-results="true">
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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
