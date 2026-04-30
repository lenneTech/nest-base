/**
 * `/admin/webhooks` — verbatim React port of
 * `webhook-inspector-ui.ts`. Same `<form class="admin-form filter">`
 * with the status `<select>`, same `.admin-table[data-deliveries]`
 * structure, same per-row redeliver button.
 *
 * The legacy renderer ships a pre-wrapped CSRF input; the React tree
 * skips it (no CSRF middleware is wired here yet) but keeps the same
 * row markup so a future server-side store can drop in without DOM
 * surgery on the client.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

type DeliveryStatus = "DELIVERED" | "FAILED";

interface DeliveryListEntry {
  id: string;
  endpointId: string;
  eventType?: string;
  status: DeliveryStatus;
  statusCode?: number;
  attemptCount: number;
  occurredAt?: string;
  errorMessage?: string;
}

interface WebhookInspectorResponse {
  deliveries: DeliveryListEntry[];
  filter?: { status?: DeliveryStatus | "ALL" };
  csrfToken?: string;
}

export function WebhookInspectorPage(): ReactNode {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const status = params.get("status") ?? "ALL";

  const url = `/admin/webhooks.json?status=${encodeURIComponent(status)}`;
  const data = useQuery({
    queryKey: ["admin", "webhooks", status],
    queryFn: () => fetchJson<WebhookInspectorResponse>(url),
  });

  return (
    <AdminShell
      title="Webhook Inspector"
      subtitle="Recent deliveries, retry counts, and re-delivery actions."
      currentNav="webhooks"
    >
      <div className="admin-card">
        <h2 className="admin-card__title">Filter</h2>
        <form className="admin-form filter" method="get" action="/admin/webhooks">
          <div className="row">
            <label>
              Status
              <select name="status" defaultValue={status}>
                <option value="ALL">All</option>
                <option value="DELIVERED">Delivered</option>
                <option value="FAILED">Failed</option>
              </select>
            </label>
            <span></span>
            <button type="submit">Apply</button>
          </div>
        </form>
      </div>
      <div className="admin-card">
        <h2 className="admin-card__title">Recent deliveries</h2>
        <DeliveriesTable response={data.data} isError={data.isError} />
      </div>
    </AdminShell>
  );
}

interface DeliveriesTableProps {
  response: WebhookInspectorResponse | undefined;
  isError: boolean;
}

function DeliveriesTable({ response, isError }: DeliveriesTableProps): ReactNode {
  if (isError) {
    return <div className="admin-empty">Failed to load deliveries.</div>;
  }
  if (!response) {
    return <div className="admin-empty">Loading…</div>;
  }
  if (response.deliveries.length === 0) {
    return <div className="admin-empty">No deliveries to show.</div>;
  }
  return (
    <table className="admin-table" data-deliveries="true">
      <thead>
        <tr>
          <th>When</th>
          <th>Event</th>
          <th>Endpoint</th>
          <th>Status</th>
          <th>HTTP</th>
          <th>Attempts</th>
          <th>Error</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {response.deliveries.map((d) => (
          <tr key={d.id} data-status={d.status}>
            <td>{d.occurredAt ?? ""}</td>
            <td>{d.eventType ?? ""}</td>
            <td>{d.endpointId}</td>
            <td>{d.status}</td>
            <td>{d.statusCode === undefined ? "" : String(d.statusCode)}</td>
            <td>{String(d.attemptCount)}</td>
            <td>{d.errorMessage ?? ""}</td>
            <td>
              <form
                className="redeliver"
                method="post"
                action={`/admin/webhooks/${encodeURIComponent(d.id)}/redeliver`}
              >
                {response.csrfToken ? (
                  <input type="hidden" name="csrf" value={response.csrfToken} />
                ) : null}
                <button type="submit">Re-deliver</button>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
