/**
 * `/admin/realtime` — verbatim React port of
 * `realtime-inspector-ui.ts`. Two cards: the active sockets table
 * (`data-sockets`) and the recent events table (`data-events`).
 *
 * Auto-refresh: the legacy renderer used `<meta http-equiv="refresh">`.
 * That mechanism does not work inside a SPA (it would reload the
 * entire bundle), so we trigger a `useQuery` `refetchInterval` instead.
 * The default is unset; callers append `?refresh=5` to enable it.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

interface ActiveSocketEntry {
  id: string;
  userId: string;
  tenantId: string;
  channels: string[];
  connectedAt: string;
}

interface RealtimeEventEntry {
  channel: string;
  eventType: string;
  payloadPreview: string;
  occurredAt: string;
}

interface RealtimeInspectorResponse {
  sockets: ActiveSocketEntry[];
  events: RealtimeEventEntry[];
  refreshSeconds?: number;
}

export function RealtimeInspectorPage(): ReactNode {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const refreshSeconds = (() => {
    const raw = params.get("refresh");
    if (!raw) return undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  })();

  const data = useQuery({
    queryKey: ["admin", "realtime"],
    queryFn: () => fetchJson<RealtimeInspectorResponse>("/admin/realtime.json"),
    refetchInterval: refreshSeconds ? refreshSeconds * 1000 : false,
  });

  return (
    <AdminShell
      title="Realtime Inspector"
      subtitle="Active Socket.IO connections and recent broadcast events."
      currentNav="realtime"
    >
      <div className="admin-card">
        <h2 className="admin-card__title">
          Active Sockets{" "}
          <span className="admin-meta">({data.data?.sockets.length ?? 0} active)</span>
        </h2>
        <SocketsTable sockets={data.data?.sockets} isError={data.isError} />
      </div>
      <div className="admin-card">
        <h2 className="admin-card__title">Recent Events</h2>
        <EventsTable events={data.data?.events} isError={data.isError} />
      </div>
    </AdminShell>
  );
}

function SocketsTable({
  sockets,
  isError,
}: {
  sockets: ActiveSocketEntry[] | undefined;
  isError: boolean;
}): ReactNode {
  if (isError) {
    return <div className="admin-empty">Failed to load sockets.</div>;
  }
  if (!sockets) {
    return <div className="admin-empty">Loading…</div>;
  }
  if (sockets.length === 0) {
    return <div className="admin-empty">No active sockets right now.</div>;
  }
  return (
    <table className="admin-table" data-sockets="true">
      <thead>
        <tr>
          <th>Socket</th>
          <th>User</th>
          <th>Tenant</th>
          <th>Channels</th>
          <th>Connected at</th>
        </tr>
      </thead>
      <tbody>
        {sockets.map((s) => (
          <tr key={s.id} data-socket-id={s.id}>
            <td>{s.id}</td>
            <td>{s.userId}</td>
            <td>{s.tenantId}</td>
            <td>
              {s.channels.length === 0 ? (
                <em>none</em>
              ) : (
                <ul className="channels">
                  {s.channels.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </td>
            <td>{s.connectedAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EventsTable({
  events,
  isError,
}: {
  events: RealtimeEventEntry[] | undefined;
  isError: boolean;
}): ReactNode {
  if (isError) {
    return <div className="admin-empty">Failed to load events.</div>;
  }
  if (!events) {
    return <div className="admin-empty">Loading…</div>;
  }
  if (events.length === 0) {
    return <div className="admin-empty">No recent events captured.</div>;
  }
  return (
    <table className="admin-table" data-events="true">
      <thead>
        <tr>
          <th>When</th>
          <th>Channel</th>
          <th>Type</th>
          <th>Preview</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e, i) => (
          <tr key={`${e.channel}-${e.occurredAt}-${i}`}>
            <td>{e.occurredAt}</td>
            <td>{e.channel}</td>
            <td>{e.eventType}</td>
            <td>
              <pre className="payload">{e.payloadPreview}</pre>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
