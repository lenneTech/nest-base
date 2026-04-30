/**
 * `/admin/audit` — verbatim React port of `audit-browser-ui.ts`.
 *
 * Same five-input filter form (action/resource/actor/from/to) wired
 * via `?action=…&resource=…` query strings. Diffs render as
 * line-prefixed `<span class="add">+ …</span>` / `<span class="del">- …</span>`
 * inside the same `<pre class="diff">` wrapper the legacy renderer
 * produced. The per-row `data-action="delete"` / `"create"` hooks are
 * preserved so the audit-browser CSS rules still target them.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

interface AuditLogEntry {
  id: string;
  action: string;
  resource: string;
  resourceId?: string;
  actorUserId?: string;
  tenantId?: string;
  occurredAt: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

interface AuditBrowserFilter {
  action?: string;
  resource?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
}

interface AuditBrowserResponse {
  entries: AuditLogEntry[];
  filter: AuditBrowserFilter;
}

export function AuditBrowserPage(): ReactNode {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const filter: AuditBrowserFilter = {};
  for (const key of ["action", "resource", "actorUserId", "from", "to"] as const) {
    const v = params.get(key);
    if (v) filter[key] = v;
  }

  const url = `/admin/audit.json?${params.toString()}`;
  const data = useQuery({
    queryKey: ["admin", "audit", url],
    queryFn: () => fetchJson<AuditBrowserResponse>(url),
  });

  return (
    <AdminShell
      title="Audit Browser"
      subtitle="Filter and inspect tenant-scoped audit-log entries with diffs."
      currentNav="audit"
    >
      <div className="admin-card">
        <h2 className="admin-card__title">Filter</h2>
        <form
          className="admin-form filter"
          method="get"
          action="/admin/audit"
          style={{ gridTemplateColumns: "repeat(5, 1fr) auto" }}
        >
          <div className="row" style={{ gridTemplateColumns: "repeat(5, 1fr) auto" }}>
            <label>
              Action
              <input
                name="action"
                defaultValue={filter.action ?? ""}
                placeholder="create / update / delete"
              />
            </label>
            <label>
              Resource
              <input
                name="resource"
                defaultValue={filter.resource ?? ""}
                placeholder="Project"
              />
            </label>
            <label>
              Actor
              <input
                name="actorUserId"
                defaultValue={filter.actorUserId ?? ""}
                placeholder="user uuid"
              />
            </label>
            <label>
              From
              <input name="from" type="date" defaultValue={filter.from ?? ""} />
            </label>
            <label>
              To
              <input name="to" type="date" defaultValue={filter.to ?? ""} />
            </label>
            <button type="submit">Filter</button>
          </div>
        </form>
      </div>
      <div className="admin-card">
        <h2 className="admin-card__title">Entries</h2>
        <EntriesTable entries={data.data?.entries} isError={data.isError} />
      </div>
    </AdminShell>
  );
}

function EntriesTable({
  entries,
  isError,
}: {
  entries: AuditLogEntry[] | undefined;
  isError: boolean;
}): ReactNode {
  if (isError) {
    return <div className="admin-empty">Failed to load audit entries.</div>;
  }
  if (!entries) {
    return <div className="admin-empty">Loading…</div>;
  }
  if (entries.length === 0) {
    return <div className="admin-empty">No audit entries match the current filter.</div>;
  }
  return (
    <table className="admin-table" data-audit-entries="true">
      <thead>
        <tr>
          <th>When</th>
          <th>Action</th>
          <th>Resource</th>
          <th>ID</th>
          <th>Actor</th>
          <th>Diff</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id} data-action={entry.action}>
            <td>{entry.occurredAt}</td>
            <td>{entry.action}</td>
            <td>{entry.resource}</td>
            <td>{entry.resourceId ?? ""}</td>
            <td>{entry.actorUserId ?? ""}</td>
            <td>
              <DiffCell before={entry.before} after={entry.after} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DiffCell({
  before,
  after,
}: {
  before: Record<string, unknown> | undefined;
  after: Record<string, unknown> | undefined;
}): ReactNode {
  if (!before && !after) return null;
  const beforeLines = before ? JSON.stringify(before, null, 2).split("\n") : [];
  const afterLines = after ? JSON.stringify(after, null, 2).split("\n") : [];
  return (
    <pre className="diff">
      {beforeLines.map((l, i) => (
        <span key={`b-${i}`} className="del">{`- ${l}\n`}</span>
      ))}
      {afterLines.map((l, i) => (
        <span key={`a-${i}`} className="add">{`+ ${l}${i < afterLines.length - 1 ? "\n" : ""}`}</span>
      ))}
    </pre>
  );
}
