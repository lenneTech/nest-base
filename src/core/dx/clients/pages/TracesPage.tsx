/**
 * `/dev/traces` — live tail of recent HTTP request traces with
 * click-to-expand DB-query drill-down.
 */
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useState, type ReactNode } from "react";

import { Card, CardContent } from "../components/ui/card.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { PageError, PageLoading, StatTile } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, formatMs } from "../lib/api.js";
import { cn } from "../lib/utils.js";

const INITIAL_ROW_CAP = 100;

interface TraceRecord {
  requestId: string;
  method: string;
  path: string;
  startedAtMs: number;
  durationMs: number;
  status: number;
  seq?: number;
}

interface TraceSummary {
  total: number;
  errors: number;
  slowestMs: number;
}

interface TracesResponse {
  traces: TraceRecord[];
  summary: TraceSummary;
}

interface QueryRecord {
  sql: string;
  durationMs: number;
}

interface QueriesResponse {
  recent: QueryRecord[];
}

export function TracesPage(): ReactNode {
  const initial = useQuery({
    queryKey: ["dev", "traces"],
    queryFn: () => fetchJson<TracesResponse>(`/hub/traces.json?limit=${INITIAL_ROW_CAP}`),
  });

  return (
    <AdminShell
      title="Traces"
      subtitle="Recent HTTP request traces (in-memory ring buffer; cleared on dev-server restart). Click a row to see which DB queries ran during that request."
      currentNav="traces"
    >
      {initial.data ? (
        <TracesBody initial={initial.data} />
      ) : initial.isError ? (
        <PageError>Failed to load traces.</PageError>
      ) : (
        <PageLoading>Loading traces…</PageLoading>
      )}
    </AdminShell>
  );
}

function TracesBody({ initial }: { initial: TracesResponse }): ReactNode {
  const newestFirst = initial.traces.slice().reverse().slice(0, INITIAL_ROW_CAP);
  const initialCursor = initial.traces.reduce((max, t) => Math.max(max, Number(t.seq ?? 0)), 0);

  const [traces, setTraces] = useState<TraceRecord[]>(newestFirst);
  const [summary, setSummary] = useState<TraceSummary>(initial.summary);
  const [statusText, setStatusText] = useState("auto-refresh");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drillCache, setDrillCache] = useState<Record<string, QueryRecord[]>>({});

  useEffect(() => {
    let cancelled = false;
    let cursor = initialCursor;
    async function tick(): Promise<void> {
      try {
        const next = await fetchJson<TracesResponse>(`/hub/traces.json?since=${cursor}`);
        if (cancelled) return;
        setSummary(next.summary);
        const fresh = (next.traces || []).filter((t) => Number(t.seq || 0) > cursor);
        if (fresh.length === 0) {
          setStatusText("auto-refresh");
          return;
        }
        fresh.sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0));
        for (const t of fresh) cursor = Math.max(cursor, Number(t.seq || 0));
        setTraces((prev) => {
          const merged = [...fresh, ...prev];
          return merged.length > INITIAL_ROW_CAP ? merged.slice(0, INITIAL_ROW_CAP) : merged;
        });
        setStatusText("auto-refresh");
      } catch {
        if (!cancelled) setStatusText("✕ refresh failed");
      }
    }
    const interval = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [initialCursor]);

  const toggleRow = async (reqId: string): Promise<void> => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(reqId)) next.delete(reqId);
      else next.add(reqId);
      return next;
    });
    if (!drillCache[reqId]) {
      try {
        const r = await fetchJson<QueriesResponse>(
          `/hub/queries.json?requestId=${encodeURIComponent(reqId)}`,
        );
        setDrillCache((prev) => ({ ...prev, [reqId]: r.recent ?? [] }));
      } catch {
        setDrillCache((prev) => ({ ...prev, [reqId]: [] }));
      }
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Total requests" value={summary.total} />
        <StatTile
          label="Server errors (5xx)"
          value={summary.errors}
          tone={summary.errors > 0 ? "err" : "default"}
        />
        <StatTile label="Slowest" value={`${Math.round(summary.slowestMs)} ms`} />
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-line bg-surface-2/60 px-4 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-ok shadow-[0_0_6px_var(--ok)]" />
            <strong className="text-fg">Live tail</strong>
            <span className="text-fg-dim">
              — polled every 2 s, click a row for query drill-down
            </span>
          </div>
          <span className="text-fg-dim">{statusText}</span>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Time</TableHead>
                <TableHead className="w-20">Method</TableHead>
                <TableHead>Path</TableHead>
                <TableHead className="w-20">Status</TableHead>
                <TableHead className="w-24">Duration</TableHead>
                <TableHead className="w-32">Request-Id</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-fg-muted">
                    No traces yet — make a request to populate.
                  </TableCell>
                </TableRow>
              ) : (
                traces.map((t) => (
                  <Fragment key={t.requestId}>
                    <TraceRow
                      trace={t}
                      expanded={expanded.has(t.requestId)}
                      onToggle={() => void toggleRow(t.requestId)}
                    />
                    {expanded.has(t.requestId) ? (
                      <DrillRow queries={drillCache[t.requestId]} />
                    ) : null}
                  </Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function TraceRow({
  trace,
  expanded,
  onToggle,
}: {
  trace: TraceRecord;
  expanded: boolean;
  onToggle: () => void;
}): ReactNode {
  const ts = new Date(trace.startedAtMs).toISOString().slice(11, 23);
  const statusFamily = Math.floor(trace.status / 100);
  const statusTone = statusFamily === 5 ? "text-err" : statusFamily === 4 ? "text-warn" : "text-ok";
  const durTone =
    trace.durationMs > 1000 ? "text-err" : trace.durationMs > 250 ? "text-warn" : "text-fg";
  const methodPalette: Record<string, string> = {
    GET: "bg-accent-soft text-accent",
    POST: "bg-ok/15 text-ok",
    PUT: "bg-warn/15 text-warn",
    PATCH: "bg-warn/15 text-warn",
    DELETE: "bg-err/15 text-err",
  };
  return (
    <TableRow className={cn("cursor-pointer", expanded && "bg-accent-soft/40")} onClick={onToggle}>
      <TableCell className="font-mono text-[0.7rem] tabular-nums text-fg-muted">{ts}</TableCell>
      <TableCell>
        <span
          className={cn(
            "inline-block rounded px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold",
            methodPalette[trace.method] ?? "bg-surface-3 text-fg-muted",
          )}
        >
          {trace.method}
        </span>
      </TableCell>
      <TableCell className="font-mono text-xs">{trace.path}</TableCell>
      <TableCell className={cn("font-mono tabular-nums", statusTone)}>{trace.status}</TableCell>
      <TableCell className={cn("font-mono tabular-nums", durTone)}>
        {Math.round(trace.durationMs)} ms
      </TableCell>
      <TableCell className="font-mono text-[0.7rem] text-fg-muted">
        {trace.requestId.slice(0, 8)}…
      </TableCell>
    </TableRow>
  );
}

function DrillRow({ queries }: { queries: QueryRecord[] | undefined }): ReactNode {
  if (queries === undefined) {
    return (
      <TableRow>
        <TableCell colSpan={6}>
          <div className="rounded-md border border-line bg-surface-2 p-3 text-sm text-fg-muted">
            Loading queries…
          </div>
        </TableCell>
      </TableRow>
    );
  }
  if (queries.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={6}>
          <div className="rounded-md border border-line bg-surface-2 p-3 text-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-dim">
              Queries fired during this request
            </div>
            <div className="text-fg-muted">No queries recorded for this request.</div>
          </div>
        </TableCell>
      </TableRow>
    );
  }
  return (
    <TableRow>
      <TableCell colSpan={6}>
        <div className="rounded-md border border-line bg-surface-2 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-dim">
            Queries fired during this request ({queries.length})
          </div>
          <div className="flex flex-col gap-1.5">
            {queries.map((q, i) => {
              const tone =
                q.durationMs > 200 ? "text-err" : q.durationMs > 50 ? "text-warn" : "text-fg";
              return (
                <div key={i} className="flex gap-3 font-mono text-[0.7rem]">
                  <div className={cn("w-16 shrink-0 tabular-nums", tone)}>
                    {formatMs(q.durationMs)}
                  </div>
                  <div className="break-all text-fg">{String(q.sql)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}
