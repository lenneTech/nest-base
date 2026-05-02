/**
 * `/api/openapi` — fetches `/api/openapi.json` and renders the spec
 * through `JsonViewer`.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { JsonViewer } from "../components/JsonViewer.js";
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

export function OpenApiPage(): ReactNode {
  const data = useQuery({
    queryKey: ["api", "openapi"],
    queryFn: () => fetchJson<unknown>("/api/openapi.json"),
  });

  return (
    <AdminShell
      title="OpenAPI Spec"
      subtitle="OpenAPI 3.1 document this server emits — consumed by Scalar UI and kubb."
      currentNav="openapi"
    >
      {data.data ? (
        <JsonViewer value={data.data} rawJsonHref="/api/openapi.json" />
      ) : data.isError ? (
        <PageError>Failed to load OpenAPI spec.</PageError>
      ) : data.isLoading ? (
        <PageLoading>Loading OpenAPI spec…</PageLoading>
      ) : (
        <PageEmpty>No OpenAPI spec available.</PageEmpty>
      )}
    </AdminShell>
  );
}
