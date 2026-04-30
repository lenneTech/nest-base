/**
 * `/errors` — verbatim React port of the JSON-viewer branch the
 * `ErrorCodeController` served via `renderJsonViewerPage`. The HTML
 * page is now the dev-portal SPA shell; this React tree fetches
 * `/errors?format=json` and renders the catalogue through the same
 * `JsonViewer` component the legacy server-side viewer wrapped.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { JsonViewer } from "../components/JsonViewer.js";
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
    <AdminShell title="Error Catalog" subtitle={subtitle} currentNav="errors">
      {data.data ? (
        <JsonViewer value={data.data} rawJsonHref="/errors?format=json" />
      ) : data.isError ? (
        <div className="admin-empty">Failed to load error catalog.</div>
      ) : (
        <div className="admin-empty">Loading error catalog…</div>
      )}
    </AdminShell>
  );
}
