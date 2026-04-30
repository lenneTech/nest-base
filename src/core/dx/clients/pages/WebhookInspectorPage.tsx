/**
 * `/admin/webhooks` — three-column webhook inspector.
 *
 * Left column  : endpoint sidebar (aggregates + sparkline per endpoint;
 *                clicking filters the delivery list).
 * Middle column: filter bar + virtual-scrolling delivery list
 *                (`@tanstack/react-virtual`, ≥100 rows on screen).
 * Right column : detail drawer with Request / Response / Attempts tabs
 *                and a CSRF-protected "Re-deliver now" action.
 *
 * Data sources:
 *   - GET /admin/webhooks.json (filter + cursor pagination)
 *   - GET /admin/webhooks/aggregates.json (endpoint cards)
 *   - GET /admin/webhooks/:id.json (detail + curl)
 *   - POST /admin/webhooks/:id/redeliver (CSRF-guarded)
 *
 * Styling reuses the existing `.admin-card` / `.admin-table` chrome.
 * Net-new components (Sparkline, virtual list, drawer tabs) layer on
 * top via dedicated `dp-webhook-*` classes in `admin-layout.css`.
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import {
  Button,
  Select,
  SelectItem,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
} from "../components/index.js";
import { Sparkline } from "../components/Sparkline.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

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
  /** Optional trace ID for the trace-link button on the drawer header. */
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
    queryFn: () => fetchJson<AggregatesResponse>("/admin/webhooks/aggregates.json"),
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
      <div className="dp-webhook-layout">
        <aside className="dp-webhook-sidebar admin-card">
          <h2 className="admin-card__title">Endpoints</h2>
          <EndpointSidebar
            data={aggregatesQuery.data}
            isError={aggregatesQuery.isError}
            isLoading={aggregatesQuery.isLoading}
            activeEndpointId={filter.endpointId}
            onSelect={handleSelectEndpoint}
          />
        </aside>
        <section className="dp-webhook-main admin-card">
          <h2 className="admin-card__title">Recent deliveries</h2>
          <FilterBar filter={filter} onChange={setFilter} />
          <DeliveriesList
            response={listQuery.data}
            isError={listQuery.isError}
            isLoading={listQuery.isLoading}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </section>
        <aside className="dp-webhook-drawer admin-card">
          <h2 className="admin-card__title">Detail</h2>
          <DetailDrawer deliveryId={selectedId} csrfToken={listQuery.data?.csrfToken} />
        </aside>
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
  return `/admin/webhooks.json?${params.toString()}`;
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
  if (isError) {
    return <div className="admin-empty">Failed to load endpoint stats.</div>;
  }
  if (isLoading || !data) {
    return <div className="admin-empty">Loading…</div>;
  }
  if (data.endpoints.length === 0) {
    return <div className="admin-empty">No endpoints registered.</div>;
  }
  return (
    <ul className="dp-webhook-endpoints">
      <li>
        <button
          type="button"
          className={`dp-webhook-endpoint${
            activeEndpointId === undefined ? " dp-webhook-endpoint--active" : ""
          }`}
          onClick={() => onSelect(undefined)}
        >
          <span className="dp-webhook-endpoint__name">All endpoints</span>
        </button>
      </li>
      {data.endpoints.map((ep) => (
        <li key={ep.endpointId}>
          <button
            type="button"
            className={`dp-webhook-endpoint${
              activeEndpointId === ep.endpointId ? " dp-webhook-endpoint--active" : ""
            }`}
            onClick={() => onSelect(ep.endpointId)}
          >
            <div className="dp-webhook-endpoint__head">
              <span className="dp-webhook-endpoint__name">{ep.endpointId}</span>
              <span className="dp-webhook-endpoint__url">{ep.endpointUrl}</span>
            </div>
            <div className="dp-webhook-endpoint__stats">
              <span className="dp-webhook-stat">
                <span className="dp-webhook-stat__label">total</span>
                <span className="dp-webhook-stat__value">{ep.total}</span>
              </span>
              <span className="dp-webhook-stat dp-webhook-stat--ok">
                <span className="dp-webhook-stat__label">ok</span>
                <span className="dp-webhook-stat__value">{ep.delivered}</span>
              </span>
              <span className="dp-webhook-stat dp-webhook-stat--fail">
                <span className="dp-webhook-stat__label">fail</span>
                <span className="dp-webhook-stat__value">{ep.failed}</span>
              </span>
              <span className="dp-webhook-stat">
                <span className="dp-webhook-stat__label">p95</span>
                <span className="dp-webhook-stat__value">{Math.round(ep.p95LatencyMs)} ms</span>
              </span>
            </div>
            <Sparkline values={ep.sparkline} />
          </button>
        </li>
      ))}
    </ul>
  );
}

interface FilterBarProps {
  filter: FilterState;
  onChange: (next: FilterState) => void;
}

function FilterBar({ filter, onChange }: FilterBarProps): ReactNode {
  return (
    <div className="dp-webhook-filterbar">
      <Select
        label="Status"
        selectedKey={filter.status}
        onSelectionChange={(key) => onChange({ ...filter, status: key as FilterState["status"] })}
      >
        <SelectItem id="ALL">All</SelectItem>
        <SelectItem id="DELIVERED">Delivered</SelectItem>
        <SelectItem id="FAILED">Failed</SelectItem>
        <SelectItem id="PENDING">Pending</SelectItem>
      </Select>
      <TextField
        label="Event-Type"
        value={filter.eventType ?? ""}
        onChange={(value) => onChange({ ...filter, eventType: value === "" ? undefined : value })}
      />
      <TextField
        label="Search ID"
        value={filter.search ?? ""}
        onChange={(value) => onChange({ ...filter, search: value === "" ? undefined : value })}
      />
      {filter.endpointId ? (
        <Button onPress={() => onChange({ ...filter, endpointId: undefined })}>
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

  if (isError) {
    return <div className="admin-empty">Failed to load deliveries.</div>;
  }
  if (isLoading || !response) {
    return <div className="admin-empty">Loading…</div>;
  }
  if (items.length === 0) {
    return <div className="admin-empty">No deliveries to show.</div>;
  }

  const virtualItems = virtualizer.getVirtualItems();
  return (
    <div
      ref={parentRef}
      className="dp-webhook-list"
      data-deliveries="true"
      role="grid"
      aria-rowcount={items.length}
    >
      <div
        className="dp-webhook-list__viewport"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtual) => {
          const row = items[virtual.index]!;
          const isSelected = row.id === selectedId;
          return (
            <button
              key={row.id}
              type="button"
              className={`dp-webhook-row${isSelected ? " dp-webhook-row--selected" : ""}`}
              data-status={row.status}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: `${virtual.size}px`,
                transform: `translateY(${virtual.start}px)`,
              }}
              onClick={() => onSelect(row.id)}
              aria-selected={isSelected}
            >
              <span className="dp-webhook-row__when">{shortDate(row.occurredAt)}</span>
              <span className="dp-webhook-row__event">{row.eventType ?? "—"}</span>
              <span className="dp-webhook-row__endpoint" title={row.endpointUrl}>
                {row.endpointId}
              </span>
              <span className="dp-webhook-row__status">
                <StatusBadge status={row.status} />
              </span>
              <span className="dp-webhook-row__http">
                {row.statusCode === undefined ? "—" : String(row.statusCode)}
              </span>
              <span className="dp-webhook-row__attempts">{row.attemptCount}</span>
              <span className="dp-webhook-row__latency">
                {row.latencyMs === undefined ? "—" : `${row.latencyMs} ms`}
              </span>
            </button>
          );
        })}
      </div>
      {response.nextCursor ? (
        <div className="dp-webhook-list__more">
          More rows available — narrow the filter to load.
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: DeliveryStatus }): ReactNode {
  const cls =
    status === "DELIVERED"
      ? "dp-webhook-badge dp-webhook-badge--ok"
      : status === "FAILED"
        ? "dp-webhook-badge dp-webhook-badge--fail"
        : "dp-webhook-badge dp-webhook-badge--pending";
  return <span className={cls}>{status}</span>;
}

interface DetailDrawerProps {
  deliveryId: string | null;
  csrfToken: string | undefined;
}

function DetailDrawer({ deliveryId, csrfToken }: DetailDrawerProps): ReactNode {
  const detailQuery = useQuery({
    queryKey: ["admin", "webhooks", "detail", deliveryId],
    queryFn: () =>
      fetchJson<DeliveryDetailResponse>(`/admin/webhooks/${encodeURIComponent(deliveryId!)}.json`),
    enabled: deliveryId !== null,
  });

  const queryClient = useQueryClient();
  const redeliverMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/admin/webhooks/${encodeURIComponent(id)}/redeliver`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ csrfToken: csrfToken ?? "" }),
      });
      if (!res.ok) {
        throw new Error(`redeliver failed: ${res.status}`);
      }
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
      /* clipboard unavailable — ignore */
    }
  }, []);

  if (deliveryId === null) {
    return <div className="admin-empty">Select a delivery to view its details.</div>;
  }
  if (detailQuery.isError) {
    return <div className="admin-empty">Failed to load delivery detail.</div>;
  }
  if (detailQuery.isLoading || !detailQuery.data) {
    return <div className="admin-empty">Loading…</div>;
  }

  const { delivery, curl } = detailQuery.data;
  return (
    <div className="dp-webhook-detail">
      <header className="dp-webhook-detail__header">
        <div>
          <StatusBadge status={delivery.status} />
          <span className="dp-webhook-detail__id">{delivery.id}</span>
        </div>
        <div className="dp-webhook-detail__meta">
          <span>{delivery.endpointUrl}</span>
          <span>
            {delivery.eventType ?? "—"} · attempt {delivery.attemptCount}
            {delivery.latencyMs !== undefined ? ` · ${delivery.latencyMs} ms` : ""}
          </span>
          {delivery.traceId ? (
            <a
              className="dp-webhook-detail__trace"
              href={`/dev/traces?traceId=${encodeURIComponent(delivery.traceId)}`}
            >
              View trace
            </a>
          ) : null}
        </div>
        <div className="dp-webhook-detail__actions">
          <Button
            isDisabled={redeliverMutation.isPending || !csrfToken}
            onPress={() => redeliverMutation.mutate(delivery.id)}
          >
            {redeliverMutation.isPending ? "Redelivering…" : "Re-deliver now"}
          </Button>
          <Button onPress={() => copyCurl(curl)}>{copied ? "Copied!" : "Copy curl"}</Button>
        </div>
        {redeliverMutation.isError ? (
          <p className="dp-webhook-detail__error">
            Redelivery failed: {String(redeliverMutation.error)}
          </p>
        ) : null}
      </header>
      <Tabs>
        <TabList aria-label="Delivery detail">
          <Tab id="request">Request</Tab>
          <Tab id="response">Response</Tab>
          <Tab id="curl">Curl</Tab>
        </TabList>
        <TabPanel id="request">
          <RequestPanel
            url={delivery.endpointUrl}
            headers={delivery.requestHeaders}
            body={delivery.requestBody}
          />
        </TabPanel>
        <TabPanel id="response">
          <ResponsePanel
            statusCode={delivery.statusCode}
            headers={delivery.responseHeaders}
            body={delivery.responseBody}
            error={delivery.errorMessage}
          />
        </TabPanel>
        <TabPanel id="curl">
          <pre className="dp-webhook-detail__curl">{curl}</pre>
        </TabPanel>
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
    <div className="dp-webhook-detail__panel">
      <dl className="dp-webhook-detail__kv">
        <dt>URL</dt>
        <dd>{url}</dd>
        <dt>Method</dt>
        <dd>POST</dd>
      </dl>
      <h3>Headers</h3>
      <HeaderTable headers={headers} highlight="webhook" />
      <h3>Body</h3>
      <pre className="dp-webhook-detail__body">{prettyJson(body)}</pre>
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
    <div className="dp-webhook-detail__panel">
      <dl className="dp-webhook-detail__kv">
        <dt>Status</dt>
        <dd>{statusCode === undefined ? "—" : String(statusCode)}</dd>
        {error ? (
          <>
            <dt>Error</dt>
            <dd>{error}</dd>
          </>
        ) : null}
      </dl>
      {headers ? (
        <>
          <h3>Headers</h3>
          <HeaderTable headers={headers} />
        </>
      ) : null}
      {body !== undefined ? (
        <>
          <h3>Body</h3>
          <pre className="dp-webhook-detail__body">{prettyJson(body)}</pre>
        </>
      ) : null}
    </div>
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
    <table className="dp-webhook-headers">
      <tbody>
        {sortedKeys.map((key) => {
          const isHighlighted = highlight !== undefined && key.toLowerCase().includes(highlight);
          return (
            <tr key={key} className={isHighlighted ? "dp-webhook-headers__row--hl" : undefined}>
              <th scope="row">{key}</th>
              <td>{headers[key]}</td>
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
