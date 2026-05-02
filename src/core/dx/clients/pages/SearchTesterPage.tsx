/**
 * `/admin/search` — cross-resource full-text search with parsed
 * tsquery diagnostics.
 *
 * Trust boundary: `ts_headline` snippets arrive from postgres
 * pre-wrapped in `<b>…</b>` markers. We render them via
 * `dangerouslySetInnerHTML` — the trust lives on the server side; the
 * snippet must already be safe by the time it reaches the `*.json`
 * sidecar response. Every other user-controlled string (resource, id,
 * title, query) goes through React's default text escaping.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.js";
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
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
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Query</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-3"
              method="get"
              action="/admin/search"
            >
              <div className="flex flex-1 min-w-72 flex-col gap-1.5">
                <Label htmlFor="q">Query</Label>
                <Input
                  id="q"
                  name="q"
                  defaultValue={query ?? ""}
                  placeholder="Type a search query and press Enter…"
                  autoFocus
                />
              </div>
              <Button type="submit">Search</Button>
            </form>
          </CardContent>
        </Card>
        {data.data?.tsquery ? (
          <Card data-tsquery="true">
            <CardHeader>
              <CardTitle>Parsed tsquery</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="m-0 rounded-md border border-line bg-surface-2 p-3 font-mono text-xs text-fg">
                {data.data.tsquery}
              </pre>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardContent>
            <Results query={query} response={data.data} isError={data.isError} />
          </CardContent>
        </Card>
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
    return <PageEmpty>Enter a query above to start searching.</PageEmpty>;
  }
  if (isError) {
    return <PageError>Search failed.</PageError>;
  }
  if (!response) {
    return <PageLoading>Searching…</PageLoading>;
  }
  if (response.hits.length === 0) {
    return (
      <PageEmpty>
        No results for "<strong className="text-fg">{query}</strong>".
      </PageEmpty>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg-muted">
        {response.hits.length} result{response.hits.length === 1 ? "" : "s"}.
      </p>
      <Table data-search-results="true">
        <TableHeader>
          <TableRow>
            <TableHead>Resource</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Snippet</TableHead>
            <TableHead className="w-20">Rank</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {response.hits.map((hit, i) => (
            <TableRow key={`${hit.resource}-${hit.id}-${i}`} data-resource={hit.resource}>
              <TableCell>
                <strong className="font-mono text-xs">{hit.resource}</strong>
                <br />
                <small className="font-mono text-[0.65rem] text-fg-muted">{hit.id}</small>
              </TableCell>
              <TableCell className="text-sm">{hit.title}</TableCell>
              {/*
                ts_headline snippet — server-trusted markup. See file
                header for the trust-boundary rationale.
              */}
              <TableCell
                className="text-xs text-fg-muted [&_b]:bg-accent-soft [&_b]:px-0.5 [&_b]:font-semibold [&_b]:text-accent"
                dangerouslySetInnerHTML={{ __html: hit.snippet }}
              />
              <TableCell className="font-mono tabular-nums">{hit.rank.toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
