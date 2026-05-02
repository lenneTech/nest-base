/**
 * `/dev/logs` — live tail of the in-memory Pino ring buffer with
 * auto-pin to bottom and "Jump to latest" affordance.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, levelName } from "../lib/api.js";
import { cn } from "../lib/utils.js";

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
        <PageError>Failed to load logs.</PageError>
      ) : (
        <PageLoading>Loading logs…</PageLoading>
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

  const bufferSize = records.length;

  useEffect(() => {
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
        if (followTailRef.current) {
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
    <Card>
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/60 px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-ok shadow-[0_0_6px_var(--ok)]" />
          <strong className="text-fg">Live tail</strong>
          <span className="text-fg-dim">— polled every 2 s, buffer {bufferSize}</span>
        </div>
        <div className="text-fg-dim">
          {errorLogs > 0 ? `${errorLogs} error${errorLogs === 1 ? "" : "s"} · ` : ""}
          {warnLogs > 0 ? `${warnLogs} warn${warnLogs === 1 ? "" : "s"} · ` : ""}
          {statusText}
        </div>
      </div>
      <CardContent className="p-0">
        <div
          className="relative max-h-[65dvh] min-h-56 overflow-auto"
          ref={scrollerRef}
          onScroll={(e) => {
            const node = e.currentTarget;
            const atBottom =
              node.scrollHeight - node.scrollTop - node.clientHeight <= TAIL_THRESHOLD_PX;
            setFollowTail(atBottom);
          }}
        >
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-surface-2">
              <TableRow>
                <TableHead className="w-24">Time</TableHead>
                <TableHead className="w-20">Level</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-fg-muted">
                    No records yet — interact with the API and they'll appear here.
                  </TableCell>
                </TableRow>
              ) : (
                records.map((r, i) => <Row key={`${r.seq ?? i}`} record={r} />)
              )}
            </TableBody>
          </Table>
          {!followTail ? (
            <Button
              type="button"
              variant="default"
              size="sm"
              className="sticky bottom-3 left-1/2 z-20 ml-[-3rem] mt-3"
              onClick={() => {
                setFollowTail(true);
                const node = scrollerRef.current;
                if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
              }}
            >
              ↓ Jump to latest
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ record }: { record: LogRecord }): ReactNode {
  const level = levelName(record.level);
  const time = new Date(record.time).toISOString().slice(11, 23);
  const tone =
    level === "fatal" || level === "error"
      ? "err"
      : level === "warn"
        ? "warn"
        : level === "info"
          ? "info"
          : "secondary";
  const rowTint =
    level === "fatal" || level === "error" ? "bg-err/5" : level === "warn" ? "bg-warn/5" : "";
  return (
    <TableRow className={cn(rowTint)}>
      <TableCell className="font-mono text-[0.7rem] tabular-nums text-fg-muted">{time}</TableCell>
      <TableCell>
        <Badge variant={tone}>{level}</Badge>
      </TableCell>
      <TableCell className="font-mono text-xs">
        {record.context ? <span className="text-accent">[{String(record.context)}]</span> : null}{" "}
        {String(record.msg ?? "")}
      </TableCell>
    </TableRow>
  );
}
