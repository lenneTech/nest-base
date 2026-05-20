/**
 * `/errors` — fetches `/errors?format=json` and renders the catalogue
 * through `JsonViewer`.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { JsonViewer } from "../components/JsonViewer.js";
import { PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

export function ErrorsPage(): ReactNode {
  const data = useQuery({
    queryKey: ["errors", "list"],
    queryFn: () => fetchJson<unknown>("/errors?format=json"),
  });

  const subtitle = (() => {
    const value = data.data;
    const count = Array.isArray(value) ? value.length : undefined;
    return count !== undefined
      ? `Public catalogue of every CORE_* error code this API can emit. ${count} entries.`
      : "Public catalogue of every CORE_* error code this API can emit.";
  })();

  return (
    <AdminShell title="Error catalog" subtitle={subtitle} currentNav="errors">
      {data.data ? (
        <JsonViewer value={data.data} rawJsonHref="/errors?format=json" />
      ) : data.isError ? (
        <PageError>Failed to load error catalog.</PageError>
      ) : (
        <PageLoading>Loading error catalog…</PageLoading>
      )}
    </AdminShell>
  );
}
