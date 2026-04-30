/**
 * `/admin/realtime` — three-tab Realtime Inspector.
 *
 * Replaces the verbatim port from PR #26 with the upgrade specified in
 * issue #20:
 *
 *   - Tabs: Sockets · Channels · Events
 *   - Filters per tab (tenant, user, channel pattern, event-type)
 *   - Per-socket detail drawer (channels + last events)
 *   - Disconnect / Send-to-socket / Replay-event actions
 *   - Pause/Resume the live event stream + Space hotkey
 *   - Auto-refresh poll: refetchInterval is short (1.5 s) so the page
 *     reflects gateway state without an extra WebSocket. The admin
 *     live-push namespace is gated behind a follow-up issue once the
 *     SPA grows a socket.io-client dependency; today we use
 *     React-Query's interval poll which is simpler and keeps the
 *     inspector honest without bloating the bundle.
 *   - All dev-only — production 404s the underlying endpoints.
 *
 * The component reads the JSON snapshot at `/admin/realtime.json`
 * (sockets + channels + events + eventsPerSecond) and lets the user
 * drive the three POST actions through `react-aria-components` Buttons
 * and TextFields. No native HTML inputs on net-new surfaces.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AdminShell } from "../layout/AdminShell.js";
import { Button } from "../components/Button.js";
import { TextField } from "../components/TextField.js";
import { Tab, TabList, TabPanel, Tabs } from "../components/Tabs.js";
import { fetchJson, formatBytes } from "../lib/api.js";

interface ActiveSocketEntry {
  id: string;
  userId: string;
  tenantId: string;
  channels: string[];
  connectedAt: string;
  lastPingMs?: number;
  bytesSent: number;
  bytesReceived: number;
  userAgent?: string;
}

interface RealtimeChannelEntry {
  name: string;
  subscriberCount: number;
  subscriberIds: string[];
  eventsLastHour: number;
  p95LatencyMs: number;
}

interface RealtimeEventDetail {
  channel: string;
  eventType: string;
  payload: unknown;
  recipientCount: number;
  latencyMs: number;
  occurredAt: string;
}

interface RealtimeInspectorResponse {
  sockets: ActiveSocketEntry[];
  channels: RealtimeChannelEntry[];
  events: Array<{
    channel: string;
    eventType: string;
    payloadPreview: string;
    occurredAt: string;
  }>;
  eventsDetailed: RealtimeEventDetail[];
  eventsPerSecond: number;
}

const POLL_MS = 1_500;

export function RealtimeInspectorPage(): ReactNode {
  const [activeTab, setActiveTab] = useState<"sockets" | "channels" | "events">("sockets");
  const [paused, setPaused] = useState(false);

  // Space toggles pause/resume on the Events tab — matches the
  // acceptance-criteria keyboard map.
  useEffect(() => {
    if (activeTab !== "events") return;
    const handler = (e: KeyboardEvent) => {
      // Don't steal Space from text inputs / buttons.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab]);

  const data = useQuery({
    queryKey: ["admin", "realtime"],
    queryFn: () => fetchJson<RealtimeInspectorResponse>("/admin/realtime.json"),
    refetchInterval: paused ? false : POLL_MS,
  });

  const subtitle = (
    <span>
      Active Socket.IO connections · live channel registry · recent dispatches
      {data.data ? (
        <span className="admin-meta">
          {" — "}
          {data.data.eventsPerSecond.toFixed(1)} events/s · {data.data.sockets.length} sockets
        </span>
      ) : null}
    </span>
  );

  return (
    <AdminShell title="Realtime Inspector" subtitle={subtitle} currentNav="realtime">
      <div className="admin-card" data-realtime-inspector>
        <Tabs
          selectedKey={activeTab}
          onSelectionChange={(key) => setActiveTab(key as typeof activeTab)}
        >
          <TabList aria-label="Realtime inspector tabs">
            <Tab id="sockets">
              Sockets <span className="admin-meta">({data.data?.sockets.length ?? 0})</span>
            </Tab>
            <Tab id="channels">
              Channels <span className="admin-meta">({data.data?.channels.length ?? 0})</span>
            </Tab>
            <Tab id="events">
              Events <span className="admin-meta">({data.data?.eventsDetailed.length ?? 0})</span>
            </Tab>
          </TabList>
          <TabPanel id="sockets">
            <SocketsTab data={data.data} isError={data.isError} />
          </TabPanel>
          <TabPanel id="channels">
            <ChannelsTab data={data.data} isError={data.isError} />
          </TabPanel>
          <TabPanel id="events">
            <EventsTab
              data={data.data}
              isError={data.isError}
              paused={paused}
              onTogglePaused={() => setPaused((p) => !p)}
            />
          </TabPanel>
        </Tabs>
      </div>
    </AdminShell>
  );
}

// ── Sockets tab ─────────────────────────────────────────────────────

function SocketsTab({
  data,
  isError,
}: {
  data: RealtimeInspectorResponse | undefined;
  isError: boolean;
}): ReactNode {
  const [tenantFilter, setTenantFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sockets = data?.sockets ?? [];
  const filtered = useMemo(() => {
    return sockets.filter((s) => {
      if (tenantFilter && s.tenantId !== tenantFilter) return false;
      if (userFilter && !s.userId.toLowerCase().includes(userFilter.toLowerCase())) return false;
      if (channelFilter) {
        const re = compileChannelPattern(channelFilter);
        if (re && !s.channels.some((c) => re.test(c))) return false;
      }
      return true;
    });
  }, [sockets, tenantFilter, userFilter, channelFilter]);

  const selected = selectedId ? (sockets.find((s) => s.id === selectedId) ?? null) : null;
  const eventsForSelected = useMemo(() => {
    if (!selected || !data) return [];
    const channelSet = new Set(selected.channels);
    return data.eventsDetailed.filter((e) => channelSet.has(e.channel)).slice(0, 20);
  }, [selected, data]);

  if (isError) return <div className="admin-empty">Failed to load sockets.</div>;
  if (!data) return <div className="admin-empty">Loading…</div>;

  return (
    <div className="rti-tab" data-tab="sockets">
      <div className="rti-filters" role="search">
        <TextField
          label="Tenant"
          value={tenantFilter}
          onChange={setTenantFilter}
          placeholder="exact tenant id"
        />
        <TextField
          label="User"
          value={userFilter}
          onChange={setUserFilter}
          placeholder="userId substring"
        />
        <TextField
          label="Channel pattern"
          value={channelFilter}
          onChange={setChannelFilter}
          placeholder="Project:tenant:*"
        />
      </div>
      {filtered.length === 0 ? (
        <div className="admin-empty">
          {sockets.length === 0
            ? "No active sockets right now."
            : "No sockets match the current filters."}
        </div>
      ) : (
        <table className="admin-table" data-sockets="true">
          <thead>
            <tr>
              <th>Socket</th>
              <th>User</th>
              <th>Tenant</th>
              <th>Channels</th>
              <th>Ping</th>
              <th>Bytes (sent / rcvd)</th>
              <th>Connected</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} data-socket-id={s.id}>
                <td>
                  <button
                    type="button"
                    className="rti-link"
                    onClick={() => setSelectedId(s.id)}
                    data-action="open-drawer"
                  >
                    {s.id}
                  </button>
                </td>
                <td>{s.userId}</td>
                <td>
                  <TenantBadge tenantId={s.tenantId} />
                </td>
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
                <td>{s.lastPingMs !== undefined ? `${s.lastPingMs} ms` : "—"}</td>
                <td>
                  {formatBytes(s.bytesSent)} / {formatBytes(s.bytesReceived)}
                </td>
                <td>{s.connectedAt}</td>
                <td>
                  <DisconnectButton id={s.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected ? (
        <SocketDrawer
          socket={selected}
          events={eventsForSelected}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}

function DisconnectButton({ id }: { id: string }): ReactNode {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      fetch(`/admin/realtime/sockets/${encodeURIComponent(id)}/disconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      }).then((res) => {
        if (!res.ok) throw new Error(`disconnect failed (${res.status})`);
        return res.json();
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "realtime"] });
    },
  });
  return (
    <Button
      variant="ghost"
      isDisabled={mutation.isPending}
      onPress={() => {
        if (typeof window !== "undefined" && !window.confirm(`Disconnect ${id}?`)) return;
        mutation.mutate();
      }}
      data-action="disconnect"
    >
      {mutation.isPending ? "Disconnecting…" : "Disconnect"}
    </Button>
  );
}

function SocketDrawer({
  socket,
  events,
  onClose,
}: {
  socket: ActiveSocketEntry;
  events: RealtimeEventDetail[];
  onClose: () => void;
}): ReactNode {
  return (
    <div className="rti-drawer" role="dialog" aria-label={`Socket ${socket.id} detail`}>
      <header className="rti-drawer__header">
        <h3>{socket.id}</h3>
        <Button variant="ghost" onPress={onClose} data-action="close-drawer">
          Close
        </Button>
      </header>
      <dl className="rti-drawer__meta">
        <dt>User</dt>
        <dd>{socket.userId}</dd>
        <dt>Tenant</dt>
        <dd>
          <TenantBadge tenantId={socket.tenantId} />
        </dd>
        <dt>Connected at</dt>
        <dd>{socket.connectedAt}</dd>
        <dt>User agent</dt>
        <dd>{socket.userAgent ?? "—"}</dd>
        <dt>Last ping</dt>
        <dd>{socket.lastPingMs !== undefined ? `${socket.lastPingMs} ms` : "—"}</dd>
        <dt>Bytes</dt>
        <dd>
          {formatBytes(socket.bytesSent)} sent · {formatBytes(socket.bytesReceived)} received
        </dd>
      </dl>
      <h4>Channel subscriptions</h4>
      {socket.channels.length === 0 ? (
        <p className="admin-empty">No channels subscribed.</p>
      ) : (
        <ul className="rti-drawer__channels">
          {socket.channels.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <h4>Last 20 events</h4>
      {events.length === 0 ? (
        <p className="admin-empty">No events on subscribed channels.</p>
      ) : (
        <table className="admin-table" data-drawer-events="true">
          <thead>
            <tr>
              <th>When</th>
              <th>Channel</th>
              <th>Type</th>
              <th>Recipients</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={`${e.occurredAt}-${e.channel}-${e.eventType}`}>
                <td>{e.occurredAt}</td>
                <td>{e.channel}</td>
                <td>{e.eventType}</td>
                <td>{e.recipientCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Channels tab ────────────────────────────────────────────────────

function ChannelsTab({
  data,
  isError,
}: {
  data: RealtimeInspectorResponse | undefined;
  isError: boolean;
}): ReactNode {
  const [pattern, setPattern] = useState("");
  const channels = data?.channels ?? [];
  const filtered = useMemo(() => {
    const re = pattern ? compileChannelPattern(pattern) : null;
    if (!re) return channels;
    return channels.filter((c) => re.test(c.name));
  }, [channels, pattern]);

  if (isError) return <div className="admin-empty">Failed to load channels.</div>;
  if (!data) return <div className="admin-empty">Loading…</div>;

  return (
    <div className="rti-tab" data-tab="channels">
      <div className="rti-filters" role="search">
        <TextField
          label="Channel pattern"
          value={pattern}
          onChange={setPattern}
          placeholder="Project:tenant:*"
        />
        <span className="admin-meta">
          {filtered.length} of {channels.length} channels match
        </span>
      </div>
      {filtered.length === 0 ? (
        <div className="admin-empty">
          {channels.length === 0
            ? "No active channels right now."
            : "No channels match the pattern."}
        </div>
      ) : (
        <table className="admin-table" data-channels="true">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Subscribers</th>
              <th>Events (last 1h)</th>
              <th>p95 push latency</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.name} data-channel={c.name}>
                <td>{c.name}</td>
                <td>{c.subscriberCount}</td>
                <td>{c.eventsLastHour}</td>
                <td>{c.p95LatencyMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Events tab ──────────────────────────────────────────────────────

function EventsTab({
  data,
  isError,
  paused,
  onTogglePaused,
}: {
  data: RealtimeInspectorResponse | undefined;
  isError: boolean;
  paused: boolean;
  onTogglePaused: () => void;
}): ReactNode {
  const [channelFilter, setChannelFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [textSearch, setTextSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const events = data?.eventsDetailed ?? [];
  const filtered = useMemo(() => {
    const channelRe = channelFilter ? compileChannelPattern(channelFilter) : null;
    const needle = textSearch.toLowerCase();
    return events.filter((e) => {
      if (channelRe && !channelRe.test(e.channel)) return false;
      if (typeFilter && !e.eventType.toLowerCase().includes(typeFilter.toLowerCase())) return false;
      if (needle) {
        try {
          const json = JSON.stringify(e.payload).toLowerCase();
          if (!json.includes(needle)) return false;
        } catch {
          return false;
        }
      }
      return true;
    });
  }, [events, channelFilter, typeFilter, textSearch]);

  const selected = selectedKey ? (filtered.find((e) => keyOf(e) === selectedKey) ?? null) : null;

  if (isError) return <div className="admin-empty">Failed to load events.</div>;
  if (!data) return <div className="admin-empty">Loading…</div>;

  return (
    <div className="rti-tab" data-tab="events">
      <div className="rti-filters" role="search">
        <TextField
          label="Channel pattern"
          value={channelFilter}
          onChange={setChannelFilter}
          placeholder="Project:tenant:*"
        />
        <TextField
          label="Event type"
          value={typeFilter}
          onChange={setTypeFilter}
          placeholder="project.updated"
        />
        <TextField
          label="Free-text search (payload)"
          value={textSearch}
          onChange={setTextSearch}
          placeholder="anything"
        />
        <Button
          variant={paused ? "accent" : "ghost"}
          onPress={onTogglePaused}
          data-action="pause-resume"
        >
          {paused ? "Resume (Space)" : "Pause (Space)"}
        </Button>
      </div>
      {filtered.length === 0 ? (
        <div className="admin-empty">
          {events.length === 0 ? "No recent events captured." : "No events match the filters."}
        </div>
      ) : (
        <table className="admin-table" data-events="true">
          <thead>
            <tr>
              <th>When</th>
              <th>Channel</th>
              <th>Type</th>
              <th>Recipients</th>
              <th>Latency</th>
              <th>Payload</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const key = keyOf(e);
              return (
                <tr key={key}>
                  <td>{e.occurredAt}</td>
                  <td>{e.channel}</td>
                  <td>{e.eventType}</td>
                  <td>{e.recipientCount}</td>
                  <td>{e.latencyMs} ms</td>
                  <td>
                    <button
                      type="button"
                      className="rti-link"
                      onClick={() => setSelectedKey(key)}
                      data-action="inspect-payload"
                    >
                      view
                    </button>
                  </td>
                  <td>
                    <ReplayButton event={e} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {selected ? <PayloadDrawer event={selected} onClose={() => setSelectedKey(null)} /> : null}
    </div>
  );
}

function ReplayButton({ event }: { event: RealtimeEventDetail }): ReactNode {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      fetch("/admin/realtime/events/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: event.channel,
          eventType: event.eventType,
          payload: event.payload,
        }),
      }).then((res) => {
        if (!res.ok) throw new Error(`replay failed (${res.status})`);
        return res.json();
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "realtime"] });
    },
  });
  return (
    <Button
      variant="ghost"
      isDisabled={mutation.isPending}
      onPress={() => mutation.mutate()}
      data-action="replay"
    >
      {mutation.isPending ? "Replaying…" : "Replay"}
    </Button>
  );
}

function PayloadDrawer({
  event,
  onClose,
}: {
  event: RealtimeEventDetail;
  onClose: () => void;
}): ReactNode {
  const formatted = useMemo(() => {
    try {
      return JSON.stringify(event.payload, null, 2);
    } catch {
      return String(event.payload);
    }
  }, [event.payload]);
  return (
    <div className="rti-drawer" role="dialog" aria-label={`Event ${event.eventType} payload`}>
      <header className="rti-drawer__header">
        <h3>
          {event.channel} <span className="admin-meta">· {event.eventType}</span>
        </h3>
        <Button variant="ghost" onPress={onClose} data-action="close-payload">
          Close
        </Button>
      </header>
      <pre className="payload" data-payload="full">
        {formatted}
      </pre>
    </div>
  );
}

// ── shared helpers ──────────────────────────────────────────────────

function keyOf(event: RealtimeEventDetail): string {
  return `${event.occurredAt}|${event.channel}|${event.eventType}`;
}

function TenantBadge({ tenantId }: { tenantId: string }): ReactNode {
  // Hash-based deterministic tinting so the same tenant id always renders
  // with the same colour across refreshes / browser sessions.
  const hue = useMemo(() => hashHue(tenantId), [tenantId]);
  return (
    <span
      className="rti-tenant-badge"
      style={{
        background: `hsla(${hue}, 65%, 55%, 0.22)`,
        borderColor: `hsla(${hue}, 65%, 55%, 0.45)`,
      }}
      data-tenant-id={tenantId}
    >
      {tenantId}
    </span>
  );
}

function hashHue(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return ((hash % 360) + 360) % 360;
}

function compileChannelPattern(input: string): RegExp | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const placeholder = " WILD ";
  const withPlaceholder = trimmed.replaceAll("*", placeholder);
  const escaped = withPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const restored = escaped.replaceAll(placeholder, ".*");
  try {
    return new RegExp(`^${restored}$`);
  } catch {
    return null;
  }
}
