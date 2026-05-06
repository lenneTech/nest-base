/**
 * `/admin/webhooks` — three-column webhook inspector with virtual
 * scrolling, sparklines per endpoint, and a CSRF-protected
 * "Re-deliver" action.
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import { Sparkline } from "../components/Sparkline.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";
import { cn } from "../lib/utils.js";

type DeliveryStatus = "DELIVERED" | "FAILED" | "PENDING";

interface DeliveryListEntry {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventType?: string;
  status: DeliveryStatus;
  statusCode?: number;
  attemptCount: number;
  latencyMs?: number;
  occurredAt: string;
  errorMessage?: string;
  traceId?: string;
}

interface WebhookInspectorResponse {
  deliveries: DeliveryListEntry[];
  filter: {
    status: DeliveryStatus | "ALL";
    endpointId?: string;
    eventType?: string;
    from?: string;
    to?: string;
    search?: string;
  };
  nextCursor?: string;
  csrfToken: string;
}

interface EndpointAggregate {
  endpointId: string;
  endpointUrl: string;
  total: number;
  delivered: number;
  failed: number;
  pending: number;
  p95LatencyMs: number;
  failureRate: number;
  lastSeenAt?: string;
  sparkline: number[];
}

interface AggregatesResponse {
  endpoints: EndpointAggregate[];
}

interface DeliveryDetailResponse {
  delivery: DeliveryListEntry & {
    requestHeaders: Record<string, string>;
    requestBody: string;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
  };
  curl: string;
}

interface FilterState {
  status: DeliveryStatus | "ALL";
  endpointId?: string;
  eventType?: string;
  search?: string;
}

const ROW_HEIGHT = 44;

export function WebhookInspectorPage(): ReactNode {
  const [filter, setFilter] = useState<FilterState>({ status: "ALL" });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["admin", "webhooks", filter],
    queryFn: () => fetchJson<WebhookInspectorResponse>(buildListUrl(filter)),
  });

  const aggregatesQuery = useQuery({
    queryKey: ["admin", "webhooks", "aggregates"],
    queryFn: () => fetchJson<AggregatesResponse>("/api/admin/webhooks/aggregates.json"),
  });

  const handleSelectEndpoint = useCallback(
    (endpointId: string | undefined) =>
      setFilter((prev) => {
        const next: FilterState = { status: prev.status };
        if (prev.eventType) next.eventType = prev.eventType;
        if (prev.search) next.search = prev.search;
        if (endpointId) next.endpointId = endpointId;
        return next;
      }),
    [],
  );

  return (
    <AdminShell
      title="Webhook Inspector"
      subtitle="Endpoint health, recent deliveries, and replay actions."
      currentNav="webhooks"
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Endpoints</CardTitle>
          </CardHeader>
          <CardContent>
            <EndpointSidebar
              data={aggregatesQuery.data}
              isError={aggregatesQuery.isError}
              isLoading={aggregatesQuery.isLoading}
              activeEndpointId={filter.endpointId}
              onSelect={handleSelectEndpoint}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent deliveries</CardTitle>
          </CardHeader>
          <CardContent>
            <FilterBar filter={filter} onChange={setFilter} />
            <DeliveriesList
              response={listQuery.data}
              isError={listQuery.isError}
              isLoading={listQuery.isLoading}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Detail</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailDrawer deliveryId={selectedId} csrfToken={listQuery.data?.csrfToken} />
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}

function buildListUrl(filter: FilterState): string {
  const params = new URLSearchParams();
  params.set("status", filter.status);
  if (filter.endpointId) params.set("endpointId", filter.endpointId);
  if (filter.eventType) params.set("eventType", filter.eventType);
  if (filter.search) params.set("search", filter.search);
  return `/api/admin/webhooks.json?${params.toString()}`;
}

interface EndpointSidebarProps {
  data: AggregatesResponse | undefined;
  isError: boolean;
  isLoading: boolean;
  activeEndpointId: string | undefined;
  onSelect: (endpointId: string | undefined) => void;
}

function EndpointSidebar({
  data,
  isError,
  isLoading,
  activeEndpointId,
  onSelect,
}: EndpointSidebarProps): ReactNode {
  if (isError) return <PageError>Failed to load endpoint stats.</PageError>;
  if (isLoading || !data) return <PageLoading>Loading…</PageLoading>;
  if (data.endpoints.length === 0) return <PageEmpty>No endpoints registered.</PageEmpty>;
  return (
    <ul className="flex flex-col gap-2">
      <li>
        <button
          type="button"
          className={cn(
            "w-full rounded-md border border-transparent p-3 text-left text-sm transition-colors hover:bg-surface-hover",
            activeEndpointId === undefined && "border-accent bg-accent-soft",
          )}
          onClick={() => onSelect(undefined)}
        >
          <span className="font-medium">All endpoints</span>
        </button>
      </li>
      {data.endpoints.map((ep) => (
        <li key={ep.endpointId}>
          <button
            type="button"
            className={cn(
              "flex w-full flex-col gap-2 rounded-md border border-line bg-surface-2 p-3 text-left text-sm transition-colors hover:border-line-accent",
              activeEndpointId === ep.endpointId && "border-accent bg-accent-soft",
            )}
            onClick={() => onSelect(ep.endpointId)}
          >
            <div className="flex flex-col">
              <span className="font-medium text-fg">{ep.endpointId}</span>
              <span className="truncate text-[0.7rem] text-fg-muted">{ep.endpointUrl}</span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-[0.65rem] text-fg-dim">
              <Stat label="total" value={ep.total} />
              <Stat label="ok" value={ep.delivered} tone="ok" />
              <Stat label="fail" value={ep.failed} tone="err" />
              <Stat label="p95" value={`${Math.round(ep.p95LatencyMs)}ms`} />
            </div>
            <Sparkline values={ep.sparkline} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "ok" | "err";
}): ReactNode {
  return (
    <span className="flex flex-col">
      <span className="uppercase tracking-wider text-fg-faint">{label}</span>
      <span
        className={cn(
          "font-mono text-xs tabular-nums text-fg",
          tone === "ok" && "text-ok",
          tone === "err" && "text-err",
        )}
      >
        {value}
      </span>
    </span>
  );
}

interface FilterBarProps {
  filter: FilterState;
  onChange: (next: FilterState) => void;
}

function FilterBar({ filter, onChange }: FilterBarProps): ReactNode {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status">Status</Label>
        <Select
          value={filter.status}
          onValueChange={(v) => onChange({ ...filter, status: v as FilterState["status"] })}
        >
          <SelectTrigger id="status" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All</SelectItem>
            <SelectItem value="DELIVERED">Delivered</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="event-type">Event-Type</Label>
        <Input
          id="event-type"
          value={filter.eventType ?? ""}
          onChange={(e) =>
            onChange({ ...filter, eventType: e.target.value === "" ? undefined : e.target.value })
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="search">Search ID</Label>
        <Input
          id="search"
          value={filter.search ?? ""}
          onChange={(e) =>
            onChange({ ...filter, search: e.target.value === "" ? undefined : e.target.value })
          }
        />
      </div>
      {filter.endpointId ? (
        <Button variant="outline" onClick={() => onChange({ ...filter, endpointId: undefined })}>
          Clear endpoint filter ({filter.endpointId})
        </Button>
      ) : null}
    </div>
  );
}

interface DeliveriesListProps {
  response: WebhookInspectorResponse | undefined;
  isError: boolean;
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function DeliveriesList({
  response,
  isError,
  isLoading,
  selectedId,
  onSelect,
}: DeliveriesListProps): ReactNode {
  const parentRef = useRef<HTMLDivElement>(null);
  const items = response?.deliveries ?? [];
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (isError) return <PageError>Failed to load deliveries.</PageError>;
  if (isLoading || !response) return <PageLoading>Loading…</PageLoading>;
  if (items.length === 0) return <PageEmpty>No deliveries to show.</PageEmpty>;

  const virtualItems = virtualizer.getVirtualItems();
  return (
    <div
      ref={parentRef}
      className="max-h-[60dvh] overflow-auto rounded-md border border-line"
      data-deliveries="true"
      role="grid"
      aria-rowcount={items.length}
    >
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualItems.map((virtual) => {
          const row = items[virtual.index]!;
          const isSelected = row.id === selectedId;
          return (
            <button
              key={row.id}
              type="button"
              data-status={row.status}
              className={cn(
                "absolute left-0 right-0 grid w-full grid-cols-[6rem_8rem_minmax(0,1fr)_5.5rem_3rem_3rem_4rem] items-center gap-2 border-b border-line/50 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover/50",
                isSelected && "bg-accent-soft",
              )}
              style={{
                height: `${virtual.size}px`,
                transform: `translateY(${virtual.start}px)`,
              }}
              onClick={() => onSelect(row.id)}
              aria-selected={isSelected}
            >
              <span className="font-mono text-[0.7rem] text-fg-muted">
                {shortDate(row.occurredAt)}
              </span>
              <span className="truncate font-mono text-[0.7rem]">{row.eventType ?? "—"}</span>
              <span className="truncate text-fg-muted" title={row.endpointUrl}>
                {row.endpointId}
              </span>
              <span>
                <StatusBadge status={row.status} />
              </span>
              <span className="text-right font-mono tabular-nums">
                {row.statusCode === undefined ? "—" : String(row.statusCode)}
              </span>
              <span className="text-right font-mono tabular-nums">{row.attemptCount}</span>
              <span className="text-right font-mono tabular-nums">
                {row.latencyMs === undefined ? "—" : `${row.latencyMs} ms`}
              </span>
            </button>
          );
        })}
      </div>
      {response.nextCursor ? (
        <div className="border-t border-line bg-surface-2 px-3 py-2 text-center text-[0.7rem] text-fg-muted">
          More rows available — narrow the filter to load.
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: DeliveryStatus }): ReactNode {
  const tone = status === "DELIVERED" ? "ok" : status === "FAILED" ? "err" : "warn";
  return <Badge variant={tone}>{status}</Badge>;
}

interface DetailDrawerProps {
  deliveryId: string | null;
  csrfToken: string | undefined;
}

function DetailDrawer({ deliveryId, csrfToken }: DetailDrawerProps): ReactNode {
  const detailQuery = useQuery({
    queryKey: ["admin", "webhooks", "detail", deliveryId],
    queryFn: () =>
      fetchJson<DeliveryDetailResponse>(`/api/admin/webhooks/${encodeURIComponent(deliveryId!)}.json`),
    enabled: deliveryId !== null,
  });

  const queryClient = useQueryClient();
  const redeliverMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/webhooks/${encodeURIComponent(id)}/redeliver`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ csrfToken: csrfToken ?? "" }),
      });
      if (!res.ok) throw new Error(`redeliver failed: ${res.status}`);
      return (await res.json()) as { delivery: DeliveryListEntry };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "webhooks"] });
    },
  });

  const [copied, setCopied] = useState(false);
  const copyCurl = useCallback(async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  if (deliveryId === null) return <PageEmpty>Select a delivery to view its details.</PageEmpty>;
  if (detailQuery.isError) return <PageError>Failed to load delivery detail.</PageError>;
  if (detailQuery.isLoading || !detailQuery.data) return <PageLoading>Loading…</PageLoading>;

  const { delivery, curl } = detailQuery.data;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge status={delivery.status} />
          <span className="font-mono text-[0.7rem] text-fg-muted">{delivery.id}</span>
        </div>
        <div className="flex flex-col gap-1 text-xs text-fg-muted">
          <span className="break-all">{delivery.endpointUrl}</span>
          <span>
            {delivery.eventType ?? "—"} · attempt {delivery.attemptCount}
            {delivery.latencyMs !== undefined ? ` · ${delivery.latencyMs} ms` : ""}
          </span>
          {delivery.traceId ? (
            <a
              className="text-accent hover:underline"
              href={`/dev/traces?traceId=${encodeURIComponent(delivery.traceId)}`}
            >
              View trace
            </a>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={redeliverMutation.isPending || !csrfToken}
            onClick={() => redeliverMutation.mutate(delivery.id)}
          >
            {redeliverMutation.isPending ? "Redelivering…" : "Re-deliver now"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => copyCurl(curl)}>
            {copied ? "Copied!" : "Copy curl"}
          </Button>
        </div>
        {redeliverMutation.isError ? (
          <p className="text-xs text-err">Redelivery failed: {String(redeliverMutation.error)}</p>
        ) : null}
      </header>
      <Tabs defaultValue="request">
        <TabsList>
          <TabsTrigger value="request">Request</TabsTrigger>
          <TabsTrigger value="response">Response</TabsTrigger>
          <TabsTrigger value="curl">Curl</TabsTrigger>
        </TabsList>
        <TabsContent value="request">
          <RequestPanel
            url={delivery.endpointUrl}
            headers={delivery.requestHeaders}
            body={delivery.requestBody}
          />
        </TabsContent>
        <TabsContent value="response">
          <ResponsePanel
            statusCode={delivery.statusCode}
            headers={delivery.responseHeaders}
            body={delivery.responseBody}
            error={delivery.errorMessage}
          />
        </TabsContent>
        <TabsContent value="curl">
          <pre className="m-0 max-h-[40vh] overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[0.7rem]">
            {curl}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface RequestPanelProps {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function RequestPanel({ url, headers, body }: RequestPanelProps): ReactNode {
  return (
    <div className="flex flex-col gap-3 text-xs">
      <KvList>
        <Kv label="URL" value={url} />
        <Kv label="Method" value="POST" />
      </KvList>
      <h3 className="text-[0.65rem] font-semibold uppercase tracking-widest text-fg-dim">
        Headers
      </h3>
      <HeaderTable headers={headers} highlight="webhook" />
      <h3 className="text-[0.65rem] font-semibold uppercase tracking-widest text-fg-dim">Body</h3>
      <pre className="m-0 max-h-[40vh] overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[0.7rem]">
        {prettyJson(body)}
      </pre>
    </div>
  );
}

interface ResponsePanelProps {
  statusCode: number | undefined;
  headers: Record<string, string> | undefined;
  body: string | undefined;
  error: string | undefined;
}

function ResponsePanel({ statusCode, headers, body, error }: ResponsePanelProps): ReactNode {
  return (
    <div className="flex flex-col gap-3 text-xs">
      <KvList>
        <Kv label="Status" value={statusCode === undefined ? "—" : String(statusCode)} />
        {error ? <Kv label="Error" value={error} /> : null}
      </KvList>
      {headers ? (
        <>
          <h3 className="text-[0.65rem] font-semibold uppercase tracking-widest text-fg-dim">
            Headers
          </h3>
          <HeaderTable headers={headers} />
        </>
      ) : null}
      {body !== undefined ? (
        <>
          <h3 className="text-[0.65rem] font-semibold uppercase tracking-widest text-fg-dim">
            Body
          </h3>
          <pre className="m-0 max-h-[40vh] overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[0.7rem]">
            {prettyJson(body)}
          </pre>
        </>
      ) : null}
    </div>
  );
}

function KvList({ children }: { children: ReactNode }): ReactNode {
  return <dl className="m-0 grid grid-cols-[6rem_minmax(0,1fr)] gap-y-1 text-xs">{children}</dl>;
}

function Kv({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <>
      <dt className="text-fg-dim">{label}</dt>
      <dd className="m-0 break-all font-mono text-fg">{value}</dd>
    </>
  );
}

function HeaderTable({
  headers,
  highlight,
}: {
  headers: Record<string, string>;
  highlight?: string;
}): ReactNode {
  const sortedKeys = useMemo(() => Object.keys(headers).sort(), [headers]);
  return (
    <table className="w-full text-[0.7rem]">
      <tbody>
        {sortedKeys.map((key) => {
          const isHighlighted = highlight !== undefined && key.toLowerCase().includes(highlight);
          return (
            <tr
              key={key}
              className={cn(
                "border-b border-line/40 last:border-0",
                isHighlighted && "bg-accent-soft/40",
              )}
            >
              <th scope="row" className="py-1 pr-2 text-left font-mono font-medium text-fg-dim">
                {key}
              </th>
              <td className="py-1 break-all font-mono text-fg">{headers[key]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function prettyJson(raw: string | undefined): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function shortDate(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
