/**
 * `/admin/permissions/test` — verbatim React port of
 * `permission-tester-ui.ts`. Same DOM, same classnames, same form
 * layout (a 1fr 1fr auto grid: userId, tenantId, submit). Submitting
 * the form fetches `/admin/permissions/test.json?userId=…&tenantId=…`
 * and renders the resulting `PermissionReport` through the same
 * `.admin-table[data-permission-report]` table the legacy renderer
 * produced.
 *
 * The form is a `GET` against the SPA route itself so URL-driven state
 * stays sharable and the back-button replays prior lookups — identical
 * to the server-rendered behaviour.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

interface ResourceReport {
  actions: string[];
  isSuperset: boolean;
}

interface PermissionReport {
  userId: string;
  tenantId: string;
  byResource: Record<string, ResourceReport>;
}

interface PermissionTestResponse {
  report: PermissionReport | null;
  submitted: { userId: string; tenantId: string };
}

export function PermissionTesterPage(): ReactNode {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const userId = params.get("userId") ?? "";
  const tenantId = params.get("tenantId") ?? "";
  const hasInputs = userId.length > 0 && tenantId.length > 0;

  const url = `/admin/permissions/test.json?userId=${encodeURIComponent(userId)}&tenantId=${encodeURIComponent(tenantId)}`;

  const data = useQuery({
    queryKey: ["admin", "permissions", "test", userId, tenantId],
    queryFn: () => fetchJson<PermissionTestResponse>(url),
    // Even with empty inputs we still want the form's submitted echo —
    // matches the legacy server which always rendered the form chrome.
    enabled: true,
  });

  return (
    <AdminShell
      title="Permission Tester"
      subtitle="Resolve effective CASL ability for a user/tenant pair."
      currentNav="permissions"
    >
      <div className="admin-card">
        <h2 className="admin-card__title">Lookup</h2>
        {/*
          GET form — react-router intercepts to preserve hash navigation
          while still refreshing query params. The native form submit
          updates the URL which triggers the useLocation -> useQuery
          chain above.
        */}
        <form method="get" className="admin-form" action="/admin/permissions/test">
          <div className="row">
            <label>
              User ID
              <input name="userId" defaultValue={userId} placeholder="user uuid" />
            </label>
            <label>
              Tenant ID
              <input name="tenantId" defaultValue={tenantId} placeholder="tenant uuid" />
            </label>
            <button type="submit">Test</button>
          </div>
        </form>
      </div>
      {hasInputs ? <ReportSection data={data.data} isError={data.isError} /> : null}
    </AdminShell>
  );
}

interface ReportSectionProps {
  data: PermissionTestResponse | undefined;
  isError: boolean;
}

function ReportSection({ data, isError }: ReportSectionProps): ReactNode {
  if (isError) {
    return (
      <div className="admin-card">
        <div className="admin-empty">Failed to resolve permissions.</div>
      </div>
    );
  }
  if (!data?.report) {
    return (
      <div className="admin-card">
        <div className="admin-empty">Resolving permissions…</div>
      </div>
    );
  }
  const report = data.report;
  const resources = Object.keys(report.byResource).sort();
  return (
    <div className="admin-card">
      <p className="admin-meta">
        User <strong>{report.userId}</strong> in tenant <strong>{report.tenantId}</strong>
      </p>
      {resources.length === 0 ? (
        <div className="admin-empty">No permissions found for this user.</div>
      ) : (
        <table className="admin-table" data-permission-report="true">
          <thead>
            <tr>
              <th>Resource</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((resource) => {
              const entry = report.byResource[resource]!;
              const actions = entry.actions.join(", ");
              return (
                <tr key={resource} data-superset={entry.isSuperset ? "true" : undefined}>
                  <td>{resource}</td>
                  <td>{actions}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
