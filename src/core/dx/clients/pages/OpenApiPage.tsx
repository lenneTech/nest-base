/**
 * `/api/openapi` — verbatim React port of the JSON-viewer branch
 * `bootstrap.ts` mounted via `renderJsonViewerPage`. The HTML page is
 * the dev-portal SPA shell; this React tree fetches
 * `/api/openapi.json` and renders the spec through the same
 * `JsonViewer` component the legacy server viewer wrapped.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { JsonViewer } from "../components/JsonViewer.js";
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
        <div className="admin-empty">Failed to load OpenAPI spec.</div>
      ) : (
        <div className="admin-empty">Loading OpenAPI spec…</div>
      )}
    </AdminShell>
  );
}
