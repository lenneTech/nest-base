/**
 * `/admin/search` — verbatim React port of `search-tester-ui.ts`.
 *
 * The query form is a 1fr/auto grid with autofocus on the input, the
 * tsquery diagnostic shows below it (when the server returned one),
 * and the results table emits the same `data-search-results="true"`
 * `<table>` the legacy renderer produced.
 *
 * Trust boundary: `ts_headline` snippets arrive from postgres
 * pre-wrapped in `<b>…</b>` markers. The legacy renderer emits them
 * verbatim. We mirror that contract via `dangerouslySetInnerHTML` —
 * the trust still lives on the server side; the snippet must already
 * be safe (controlled vocabulary) by the time it reaches the
 * `*.json` sidecar response. Every other user-controlled string
 * (resource, id, title, query) goes through React's default text
 * escaping.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

interface SearchHit {
  resource: string;
  id: string;
  title: string;
  /** ts_headline output — server-trusted, contains `<b>` markers. */
  snippet: string;
  rank: number;
}

interface SearchTesterResponse {
  query?: string;
  tsquery?: string;
  hits: SearchHit[];
}

export function SearchTesterPage(): ReactNode {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const query = params.get("q") ?? undefined;

  const url = `/admin/search.json?${params.toString()}`;
  const data = useQuery({
    queryKey: ["admin", "search", url],
    queryFn: () => fetchJson<SearchTesterResponse>(url),
    enabled: query !== undefined,
  });

  return (
    <AdminShell
      title="Search Tester"
      subtitle="Cross-resource full-text search with parsed tsquery diagnostics."
      currentNav="search"
    >
      <div className="admin-card">
        <h2 className="admin-card__title">Query</h2>
        <form className="admin-form q" method="get" action="/admin/search">
          <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
            <label>
              Query
              <input
                name="q"
                defaultValue={query ?? ""}
                placeholder="Type a search query and press Enter…"
                autoFocus
              />
            </label>
            <button type="submit">Search</button>
          </div>
        </form>
      </div>
      {data.data?.tsquery ? (
        <div className="admin-card" data-tsquery="true">
          <h2 className="admin-card__title">Parsed tsquery</h2>
          <pre className="tsquery">{data.data.tsquery}</pre>
        </div>
      ) : null}
      <div className="admin-card">
        <h2 className="admin-card__title">Results</h2>
        <Results query={query} response={data.data} isError={data.isError} />
      </div>
    </AdminShell>
  );
}

function Results({
  query,
  response,
  isError,
}: {
  query: string | undefined;
  response: SearchTesterResponse | undefined;
  isError: boolean;
}): ReactNode {
  if (query === undefined) {
    return <div className="admin-empty">Enter a query above to start searching.</div>;
  }
  if (isError) {
    return <div className="admin-empty">Search failed.</div>;
  }
  if (!response) {
    return <div className="admin-empty">Searching…</div>;
  }
  if (response.hits.length === 0) {
    return (
      <div className="admin-empty">
        No results for "<strong>{query}</strong>".
      </div>
    );
  }
  return (
    <>
      <p className="admin-meta">
        {response.hits.length} result{response.hits.length === 1 ? "" : "s"}.
      </p>
      <table className="admin-table" data-search-results="true">
        <thead>
          <tr>
            <th>Resource</th>
            <th>Title</th>
            <th>Snippet</th>
            <th>Rank</th>
          </tr>
        </thead>
        <tbody>
          {response.hits.map((hit, i) => (
            <tr key={`${hit.resource}-${hit.id}-${i}`} data-resource={hit.resource}>
              <td>
                <strong>{hit.resource}</strong>
                <br />
                <small>{hit.id}</small>
              </td>
              <td>{hit.title}</td>
              {/*
                ts_headline snippet — server-trusted markup. See file
                header for the trust-boundary rationale.
              */}
              <td className="snippet" dangerouslySetInnerHTML={{ __html: hit.snippet }} />
              <td className="rank">{hit.rank.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
