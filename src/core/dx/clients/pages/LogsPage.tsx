/**
 * `/dev/logs` — verbatim React port of `log-viewer-ui.ts`. Same
 * sticky-header table inside a `.log-scroll` container, same auto-tail
 * behaviour (re-pin on scroll-to-bottom, "Jump to latest" pill when
 * the user has scrolled up), same level chips and row tints.
 *
 * Live polling uses `/dev/logs.json?since=<seq>` every 2 s exactly
 * like the legacy embedded script. Capped at 500 rows in the DOM so
 * the buffer can't drown the page.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, levelName } from "../lib/api.js";

interface LogRecord {
  level: number;
  time: number;
  msg?: string;
  context?: string;
  seq?: number;
}

const TAIL_THRESHOLD_PX = 32;
const MAX_ROWS = 500;

export function LogsPage(): ReactNode {
  // The data endpoint returns the recent ring buffer; we additionally
  // poll `/dev/logs.json?since=<seq>` for the live tail.
  const initial = useQuery({
    queryKey: ["dev", "logs", "initial"],
    queryFn: async () => {
      const records = await fetchJson<LogRecord[]>("/dev/logs.json");
      return records;
    },
  });

  return (
    <AdminShell
      title="Logs"
      subtitle="In-memory ring buffer of every Pino record this server emits."
      currentNav="logs"
    >
      {initial.data ? (
        <LogsBody initialRecords={initial.data} />
      ) : initial.isError ? (
        <div className="admin-empty">Failed to load logs.</div>
      ) : (
        <div className="admin-empty">Loading logs…</div>
      )}
    </AdminShell>
  );
}

function LogsBody({ initialRecords }: { initialRecords: LogRecord[] }): ReactNode {
  const [records, setRecords] = useState<LogRecord[]>(initialRecords);
  const [followTail, setFollowTail] = useState(true);
  const [statusText, setStatusText] = useState("auto-refresh");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const followTailRef = useRef(true);
  followTailRef.current = followTail;

  // Capacity isn't returned by `/dev/logs.json` — we only need it for
  // the toolbar caption. The legacy server-rendered page got it from
  // the input; here we display the live count and a sensible "of
  // <X>+" caption.
  const bufferSize = records.length;

  useEffect(() => {
    // Pin to the bottom on first paint, mirroring the server JS.
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let cursor = records.length > 0 ? Number(records[records.length - 1]?.seq ?? 0) : 0;
    async function tick(): Promise<void> {
      try {
        const next = await fetchJson<LogRecord[]>(`/dev/logs.json?since=${cursor}`);
        if (cancelled) return;
        if (next.length === 0) return;
        for (const rec of next) {
          cursor = Math.max(cursor, Number(rec.seq) || 0);
        }
        setRecords((prev) => {
          const merged = [...prev, ...next];
          return merged.length > MAX_ROWS ? merged.slice(merged.length - MAX_ROWS) : merged;
        });
        // Auto-tail only when the user is already pinned to the bottom.
        if (followTailRef.current) {
          // Defer to allow the row to mount before scrolling.
          setTimeout(() => {
            const node = scrollerRef.current;
            if (node) node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
          }, 0);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot setup
  }, []);

  const errorLogs = records.filter((r) => r.level >= 50).length;
  const warnLogs = records.filter((r) => r.level === 40).length;

  return (
    <div className="admin-card">
      <div className="log-toolbar">
        <div>
          <span className="log-pulse" />
          <strong>Live tail</strong>
          <span className="log-toolbar__meta"> — polled every 2 s, ring-buffer {bufferSize}</span>
        </div>
        <div className="log-toolbar__meta">
          {errorLogs > 0 ? `${errorLogs} error${errorLogs === 1 ? "" : "s"} · ` : ""}
          {warnLogs > 0 ? `${warnLogs} warn${warnLogs === 1 ? "" : "s"} · ` : ""}
          {statusText}
        </div>
      </div>
      <div
        className="log-scroll"
        ref={scrollerRef}
        onScroll={(e) => {
          const node = e.currentTarget;
          const atBottom =
            node.scrollHeight - node.scrollTop - node.clientHeight <= TAIL_THRESHOLD_PX;
          setFollowTail(atBottom);
        }}
      >
        {records.length === 0 ? (
          <>
            <table className="log-table">
              <thead>
                <tr>
                  <th style={{ width: "6rem" }}>Time</th>
                  <th style={{ width: "5rem" }}>Level</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody />
            </table>
            <div className="log-empty">
              No records yet — interact with the API and they'll appear here.
            </div>
          </>
        ) : (
          <table className="log-table">
            <thead>
              <tr>
                <th style={{ width: "6rem" }}>Time</th>
                <th style={{ width: "5rem" }}>Level</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <Row key={`${r.seq ?? i}`} record={r} />
              ))}
            </tbody>
          </table>
        )}
        <button
          type="button"
          className={`log-jump${followTail ? "" : " is-visible"}`}
          onClick={() => {
            setFollowTail(true);
            const node = scrollerRef.current;
            if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
          }}
        >
          ↓ Jump to latest
        </button>
      </div>
    </div>
  );
}

function Row({ record }: { record: LogRecord }): ReactNode {
  const level = levelName(record.level);
  const time = new Date(record.time).toISOString().slice(11, 23);
  return (
    <tr className={`log-row--${level}`}>
      <td>{time}</td>
      <td>
        <span className={`log-level log-level--${level}`}>{level}</span>
      </td>
      <td>
        {record.context ? <span className="log-context">[{String(record.context)}]</span> : null}{" "}
        {String(record.msg ?? "")}
      </td>
    </tr>
  );
}
