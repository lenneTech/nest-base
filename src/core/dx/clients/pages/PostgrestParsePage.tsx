/**
 * `/dev/postgrest-parse` — accepts arbitrary `?key=op.value` filters
 * and renders the resulting Prisma `where` clause through
 * `JsonViewer`.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { JsonViewer } from "../components/JsonViewer.js";
import { PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

interface PostgrestParseResponse {
  where: unknown;
  query: Record<string, string>;
}

export function PostgrestParsePage(): ReactNode {
  const location = useLocation();
  const [search, setSearch] = useState(location.search);
  useEffect(() => {
    setSearch(location.search);
  }, [location.search]);

  // The server endpoint expects `format=json` to return JSON. We
  // forward the user's other filter params verbatim.
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("format", "json");
  const fetchUrl = `/api/hub/postgrest-parse?${params.toString()}`;
  const filterParams = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  filterParams.delete("format");
  const filterCount = Array.from(filterParams.keys()).length;

  const data = useQuery({
    queryKey: ["dev", "postgrest-parse", fetchUrl],
    queryFn: () => fetchJson<PostgrestParseResponse>(fetchUrl),
  });

  return (
    <AdminShell
      title="PostgREST Parser"
      subtitle="Mapping of `?key=op.value` query strings to a Prisma `where` clause."
      currentNav="postgrest-parse"
    >
      {filterCount === 0 ? (
        <p className="mb-4 text-sm text-fg-muted">
          Try{" "}
          <a
            className="text-accent underline-offset-4 hover:underline"
            href="/api/hub/postgrest-parse?status=eq.draft&age=gte.18"
          >
            ?status=eq.draft&age=gte.18
          </a>{" "}
          to see how PostgREST-style filters map to a Prisma WHERE clause.
        </p>
      ) : null}
      {data.data ? (
        <JsonViewer value={data.data} rawJsonHref={fetchUrl} />
      ) : data.isError ? (
        <PageError>Failed to parse query.</PageError>
      ) : (
        <PageLoading>Parsing query…</PageLoading>
      )}
    </AdminShell>
  );
}
