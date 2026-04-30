/**
 * `/dev/traces` — verbatim React port of `trace-viewer-ui.ts`. Same
 * 3-tile summary, same sticky-header live-tail table newest-first,
 * same per-row click-to-expand drill-down that fetches
 * `/dev/queries.json?requestId=…` and renders the queries fired
 * during that request.
 *
 * Live polling: every 2 s `/dev/traces.json?since=<seq>`. Newest
 * traces prepend to the top; the DOM is capped at INITIAL_ROW_CAP
 * (100) so a torrent can't choke the page.
 */
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useState, type ReactNode } from "react";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, formatMs } from "../lib/api.js";

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
    queryFn: () => fetchJson<TracesResponse>(`/dev/traces.json?limit=${INITIAL_ROW_CAP}`),
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
        <div className="admin-empty">Failed to load traces.</div>
      ) : (
        <div className="admin-empty">Loading traces…</div>
      )}
    </AdminShell>
  );
}

function TracesBody({ initial }: { initial: TracesResponse }): ReactNode {
  // Newest first, capped to INITIAL_ROW_CAP. The poller prepends new
  // traces and trims older ones from the bottom.
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
        const next = await fetchJson<TracesResponse>(`/dev/traces.json?since=${cursor}`);
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
          `/dev/queries.json?requestId=${encodeURIComponent(reqId)}`,
        );
        setDrillCache((prev) => ({ ...prev, [reqId]: r.recent ?? [] }));
      } catch {
        setDrillCache((prev) => ({ ...prev, [reqId]: [] }));
      }
    }
  };

  return (
    <>
      <div className="tv-tiles">
        <div className="tv-tile">
          <div className="tv-tile__title">Total requests</div>
          <div className="tv-tile__value">{summary.total}</div>
        </div>
        <div className={`tv-tile${summary.errors > 0 ? " tv-tile--bad" : ""}`}>
          <div className="tv-tile__title">Server errors (5xx)</div>
          <div className="tv-tile__value">{summary.errors}</div>
        </div>
        <div className="tv-tile">
          <div className="tv-tile__title">Slowest</div>
          <div className="tv-tile__value">{Math.round(summary.slowestMs)} ms</div>
        </div>
      </div>

      <div className="tv-toolbar">
        <div>
          <span className="tv-pulse" />
          <strong>Live tail</strong>
          <span className="tv-toolbar__meta">
            {" "}
            — polled every 2 s, click a row for query drill-down
          </span>
        </div>
        <div className="tv-toolbar__meta">{statusText}</div>
      </div>

      <div className="tv-scroll">
        <table className="tv-table">
          <thead>
            <tr>
              <th style={{ width: "7rem" }}>Time</th>
              <th style={{ width: "5rem" }}>Method</th>
              <th>Path</th>
              <th style={{ width: "5rem" }}>Status</th>
              <th style={{ width: "6rem" }}>Duration</th>
              <th style={{ width: "8rem" }}>Request-Id</th>
            </tr>
          </thead>
          <tbody>
            {traces.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{ color: "var(--fg-dim)", textAlign: "center", padding: "1.5rem" }}
                >
                  No traces yet — make a request to populate.
                </td>
              </tr>
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
          </tbody>
        </table>
      </div>
    </>
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
  const statusClass = `tv-status--${Math.floor(trace.status / 100)}`;
  const methodClass = `tv-method--${trace.method}`;
  const durClass =
    trace.durationMs > 1000
      ? "tv-duration--vslow"
      : trace.durationMs > 250
        ? "tv-duration--slow"
        : "";
  return (
    <tr className={`tv-row${expanded ? " tv-row--expanded" : ""}`} onClick={onToggle}>
      <td>{ts}</td>
      <td>
        <span className={`tv-method ${methodClass}`}>{trace.method}</span>
      </td>
      <td>{trace.path}</td>
      <td className={statusClass}>{trace.status}</td>
      <td className={durClass}>{Math.round(trace.durationMs)} ms</td>
      <td style={{ color: "var(--fg-muted)" }}>{trace.requestId.slice(0, 8)}…</td>
    </tr>
  );
}

function DrillRow({ queries }: { queries: QueryRecord[] | undefined }): ReactNode {
  if (queries === undefined) {
    return (
      <tr className="tv-drill-row">
        <td colSpan={6}>
          <div className="tv-drill">
            <div className="tv-drill__title">Loading queries…</div>
          </div>
        </td>
      </tr>
    );
  }
  if (queries.length === 0) {
    return (
      <tr className="tv-drill-row">
        <td colSpan={6}>
          <div className="tv-drill">
            <div className="tv-drill__title">Queries fired during this request</div>
            <div className="tv-drill__empty">No queries recorded for this request.</div>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr className="tv-drill-row">
      <td colSpan={6}>
        <div className="tv-drill">
          <div className="tv-drill__title">
            Queries fired during this request ({queries.length})
          </div>
          {queries.map((q, i) => {
            const dc =
              q.durationMs > 200
                ? "tv-drill__dur--bad"
                : q.durationMs > 50
                  ? "tv-drill__dur--slow"
                  : "";
            return (
              <div key={i} className="tv-drill__row">
                <div className={`tv-drill__dur ${dc}`}>{formatMs(q.durationMs)}</div>
                <div className="tv-drill__sql">{String(q.sql)}</div>
              </div>
            );
          })}
        </div>
      </td>
    </tr>
  );
}
