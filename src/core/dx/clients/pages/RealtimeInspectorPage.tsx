/**
 * `/admin/realtime` — three-tab Realtime Inspector (Sockets · Channels
 * · Events) with per-tab filters, drawers, and disconnect / replay
 * actions. Auto-refresh poll at 1.5 s; Space toggles pause on Events.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
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
  const [activeTab, setActiveTab] = useState<string>("sockets");
  const [paused, setPaused] = useState(false);

  // Space toggles pause/resume on the Events tab — matches the
  // acceptance-criteria keyboard map.
  useEffect(() => {
    if (activeTab !== "events") return;
    const handler = (e: KeyboardEvent) => {
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
    queryFn: () => fetchJson<RealtimeInspectorResponse>("/api/admin/realtime.json"),
    refetchInterval: paused ? false : POLL_MS,
  });

  const subtitle = (
    <>
      Active Socket.IO connections · live channel registry · recent dispatches
      {data.data ? (
        <span className="text-fg-dim">
          {" — "}
          {data.data.eventsPerSecond.toFixed(1)} events/s · {data.data.sockets.length} sockets
        </span>
      ) : null}
    </>
  );

  return (
    <AdminShell title="Realtime Inspector" subtitle={subtitle} currentNav="realtime">
      <Card data-realtime-inspector>
        <CardContent className="p-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="sockets">
                Sockets <span className="ml-2 text-fg-dim">({data.data?.sockets.length ?? 0})</span>
              </TabsTrigger>
              <TabsTrigger value="channels">
                Channels{" "}
                <span className="ml-2 text-fg-dim">({data.data?.channels.length ?? 0})</span>
              </TabsTrigger>
              <TabsTrigger value="events">
                Events{" "}
                <span className="ml-2 text-fg-dim">({data.data?.eventsDetailed.length ?? 0})</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="sockets">
              <SocketsTab data={data.data} isError={data.isError} />
            </TabsContent>
            <TabsContent value="channels">
              <ChannelsTab data={data.data} isError={data.isError} />
            </TabsContent>
            <TabsContent value="events">
              <EventsTab
                data={data.data}
                isError={data.isError}
                paused={paused}
                onTogglePaused={() => setPaused((p) => !p)}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
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

  if (isError) return <PageError>Failed to load sockets.</PageError>;
  if (!data) return <PageLoading>Loading…</PageLoading>;

  return (
    <div className="flex flex-col gap-3" data-tab="sockets">
      <FiltersBar>
        <FilterInput
          label="Tenant"
          value={tenantFilter}
          onChange={setTenantFilter}
          hint="exact tenant id"
        />
        <FilterInput
          label="User"
          value={userFilter}
          onChange={setUserFilter}
          hint="userId substring"
        />
        <FilterInput
          label="Channel pattern"
          value={channelFilter}
          onChange={setChannelFilter}
          hint="Project:tenant:*"
        />
      </FiltersBar>
      {filtered.length === 0 ? (
        <PageEmpty>
          {sockets.length === 0
            ? "No active sockets right now."
            : "No sockets match the current filters."}
        </PageEmpty>
      ) : (
        <Table data-sockets="true">
          <TableHeader>
            <TableRow>
              <TableHead>Socket</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Tenant</TableHead>
              <TableHead>Channels</TableHead>
              <TableHead>Ping</TableHead>
              <TableHead>Bytes (sent / rcvd)</TableHead>
              <TableHead>Connected</TableHead>
              <TableHead aria-label="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((s) => (
              <TableRow key={s.id} data-socket-id={s.id}>
                <TableCell>
                  <button
                    type="button"
                    className="font-mono text-xs text-accent hover:underline"
                    onClick={() => setSelectedId(s.id)}
                    data-action="open-drawer"
                  >
                    {s.id}
                  </button>
                </TableCell>
                <TableCell className="font-mono text-xs">{s.userId}</TableCell>
                <TableCell>
                  <TenantBadge tenantId={s.tenantId} />
                </TableCell>
                <TableCell>
                  {s.channels.length === 0 ? (
                    <em className="text-fg-faint">none</em>
                  ) : (
                    <ul className="flex flex-col gap-0.5 font-mono text-[0.7rem]">
                      {s.channels.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {s.lastPingMs !== undefined ? `${s.lastPingMs} ms` : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {formatBytes(s.bytesSent)} / {formatBytes(s.bytesReceived)}
                </TableCell>
                <TableCell className="font-mono text-[0.7rem]">{s.connectedAt}</TableCell>
                <TableCell>
                  <DisconnectButton id={s.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => (!open ? setSelectedId(null) : undefined)}
      >
        {selected ? <SocketDrawer socket={selected} events={eventsForSelected} /> : null}
      </Sheet>
    </div>
  );
}

function FiltersBar({ children }: { children: ReactNode }): ReactNode {
  return (
    <div
      className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-surface-2 p-3"
      role="search"
    >
      {children}
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}): ReactNode {
  const id = label.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint}
        className="w-44"
      />
    </div>
  );
}

function DisconnectButton({ id }: { id: string }): ReactNode {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      fetch(`/api/admin/realtime/sockets/${encodeURIComponent(id)}/disconnect`, {
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
      size="sm"
      disabled={mutation.isPending}
      onClick={() => {
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
}: {
  socket: ActiveSocketEntry;
  events: RealtimeEventDetail[];
}): ReactNode {
  return (
    <SheetContent
      className="overflow-y-auto sm:max-w-2xl"
      aria-label={`Socket ${socket.id} detail`}
    >
      <SheetHeader>
        <SheetTitle>{socket.id}</SheetTitle>
        <SheetDescription>Socket detail and recent events.</SheetDescription>
      </SheetHeader>
      <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-2 text-xs">
        <dt className="text-fg-dim">User</dt>
        <dd className="font-mono">{socket.userId}</dd>
        <dt className="text-fg-dim">Tenant</dt>
        <dd>
          <TenantBadge tenantId={socket.tenantId} />
        </dd>
        <dt className="text-fg-dim">Connected at</dt>
        <dd className="font-mono">{socket.connectedAt}</dd>
        <dt className="text-fg-dim">User agent</dt>
        <dd className="font-mono">{socket.userAgent ?? "—"}</dd>
        <dt className="text-fg-dim">Last ping</dt>
        <dd className="font-mono">
          {socket.lastPingMs !== undefined ? `${socket.lastPingMs} ms` : "—"}
        </dd>
        <dt className="text-fg-dim">Bytes</dt>
        <dd className="font-mono">
          {formatBytes(socket.bytesSent)} sent · {formatBytes(socket.bytesReceived)} received
        </dd>
      </dl>
      <h4 className="mt-4 text-sm font-semibold">Channel subscriptions</h4>
      {socket.channels.length === 0 ? (
        <PageEmpty>No channels subscribed.</PageEmpty>
      ) : (
        <ul className="mt-2 flex flex-col gap-1 font-mono text-xs">
          {socket.channels.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <h4 className="mt-4 text-sm font-semibold">Last 20 events</h4>
      {events.length === 0 ? (
        <PageEmpty>No events on subscribed channels.</PageEmpty>
      ) : (
        <Table data-drawer-events="true">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Recipients</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={`${e.occurredAt}-${e.channel}-${e.eventType}`}>
                <TableCell className="font-mono text-[0.7rem]">{e.occurredAt}</TableCell>
                <TableCell className="font-mono text-xs">{e.channel}</TableCell>
                <TableCell className="font-mono text-xs">{e.eventType}</TableCell>
                <TableCell className="font-mono tabular-nums">{e.recipientCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SheetContent>
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

  if (isError) return <PageError>Failed to load channels.</PageError>;
  if (!data) return <PageLoading>Loading…</PageLoading>;

  return (
    <div className="flex flex-col gap-3" data-tab="channels">
      <FiltersBar>
        <FilterInput
          label="Channel pattern"
          value={pattern}
          onChange={setPattern}
          hint="Project:tenant:*"
        />
        <span className="text-xs text-fg-muted">
          {filtered.length} of {channels.length} channels match
        </span>
      </FiltersBar>
      {filtered.length === 0 ? (
        <PageEmpty>
          {channels.length === 0
            ? "No active channels right now."
            : "No channels match the pattern."}
        </PageEmpty>
      ) : (
        <Table data-channels="true">
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead>Subscribers</TableHead>
              <TableHead>Events (last 1h)</TableHead>
              <TableHead>p95 push latency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.name} data-channel={c.name}>
                <TableCell className="font-mono text-xs">{c.name}</TableCell>
                <TableCell className="font-mono tabular-nums">{c.subscriberCount}</TableCell>
                <TableCell className="font-mono tabular-nums">{c.eventsLastHour}</TableCell>
                <TableCell className="font-mono tabular-nums">{c.p95LatencyMs} ms</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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

  if (isError) return <PageError>Failed to load events.</PageError>;
  if (!data) return <PageLoading>Loading…</PageLoading>;

  return (
    <div className="flex flex-col gap-3" data-tab="events">
      <FiltersBar>
        <FilterInput
          label="Channel pattern"
          value={channelFilter}
          onChange={setChannelFilter}
          hint="Project:tenant:*"
        />
        <FilterInput
          label="Event type"
          value={typeFilter}
          onChange={setTypeFilter}
          hint="project.updated"
        />
        <FilterInput
          label="Free-text search (payload)"
          value={textSearch}
          onChange={setTextSearch}
          hint="anything"
        />
        <Button
          variant={paused ? "default" : "outline"}
          onClick={onTogglePaused}
          data-action="pause-resume"
        >
          {paused ? "Resume (Space)" : "Pause (Space)"}
        </Button>
      </FiltersBar>
      {filtered.length === 0 ? (
        <PageEmpty>
          {events.length === 0 ? "No recent events captured." : "No events match the filters."}
        </PageEmpty>
      ) : (
        <Table data-events="true">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Recipients</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Payload</TableHead>
              <TableHead aria-label="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((e) => {
              const key = keyOf(e);
              return (
                <TableRow key={key}>
                  <TableCell className="font-mono text-[0.7rem]">{e.occurredAt}</TableCell>
                  <TableCell className="font-mono text-xs">{e.channel}</TableCell>
                  <TableCell className="font-mono text-xs">{e.eventType}</TableCell>
                  <TableCell className="font-mono tabular-nums">{e.recipientCount}</TableCell>
                  <TableCell className="font-mono tabular-nums">{e.latencyMs} ms</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() => setSelectedKey(key)}
                      data-action="inspect-payload"
                    >
                      view
                    </button>
                  </TableCell>
                  <TableCell>
                    <ReplayButton event={e} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => (!open ? setSelectedKey(null) : undefined)}
      >
        {selected ? <PayloadDrawer event={selected} /> : null}
      </Sheet>
    </div>
  );
}

function ReplayButton({ event }: { event: RealtimeEventDetail }): ReactNode {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      fetch("/api/admin/realtime/events/replay", {
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
      size="sm"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
      data-action="replay"
    >
      {mutation.isPending ? "Replaying…" : "Replay"}
    </Button>
  );
}

function PayloadDrawer({ event }: { event: RealtimeEventDetail }): ReactNode {
  const formatted = useMemo(() => {
    try {
      return JSON.stringify(event.payload, null, 2);
    } catch {
      return String(event.payload);
    }
  }, [event.payload]);
  return (
    <SheetContent
      className="overflow-y-auto sm:max-w-2xl"
      aria-label={`Event ${event.eventType} payload`}
    >
      <SheetHeader>
        <SheetTitle>{event.channel}</SheetTitle>
        <SheetDescription>· {event.eventType}</SheetDescription>
      </SheetHeader>
      <pre
        className="mt-4 m-0 max-h-[70vh] overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-xs"
        data-payload="full"
      >
        {formatted}
      </pre>
    </SheetContent>
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
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[0.65rem]"
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
  // Sentinel that no user-typed pattern would contain — survives
  // the regex-escape pass so we can swap it back to `.*` afterwards.
  const wildSentinel = " WILD ";
  const sentinelised = trimmed.replaceAll("*", wildSentinel);
  const escaped = sentinelised.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const restored = escaped.replaceAll(wildSentinel, ".*");
  try {
    return new RegExp(`^${restored}$`);
  } catch {
    return null;
  }
}
