/**
 * `/hub/queries` — recent / slowest / most-frequent Prisma queries.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { PageEmpty, PageError, PageLoading, StatTile } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, formatMs } from "../lib/api.js";
import { cn } from "../lib/utils.js";

const WARN_THRESHOLD_MS = 50;
const BAD_THRESHOLD_MS = 200;

interface QueryRecord {
  sql: string;
  durationMs: number;
}
interface TemplateGroup {
  template: string;
  count: number;
  totalMs: number;
  sample: string;
}
interface QuerySummary {
  total: number;
  slowestMs: number;
  warnCount: number;
  badCount: number;
}

interface QueriesResponse {
  recent: QueryRecord[];
  slowest: QueryRecord[];
  topTemplates: TemplateGroup[];
  summary: QuerySummary;
}

export function QueriesPage(): ReactNode {
  const data = useQuery({
    queryKey: ["hub", "queries"],
    queryFn: () => fetchJson<QueriesResponse>("/hub/queries.json"),
    refetchInterval: 3_000,
  });

  return (
    <AdminShell
      title="Queries"
      subtitle="In-memory ring buffer of every Prisma query event this server emitted. Cleared on dev-server restart."
      currentNav="queries"
    >
      {data.data ? (
        <QueriesBody report={data.data} />
      ) : data.isError ? (
        <PageError>Failed to load queries.</PageError>
      ) : (
        <PageLoading>Loading queries…</PageLoading>
      )}
    </AdminShell>
  );
}

function QueriesBody({ report }: { report: QueriesResponse }): ReactNode {
  const recent = report.recent.slice().reverse().slice(0, 50);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total queries" value={report.summary.total} />
        <StatTile
          label={`Slow (> ${WARN_THRESHOLD_MS} ms)`}
          value={report.summary.warnCount}
          tone={report.summary.warnCount > 0 ? "warn" : "default"}
        />
        <StatTile
          label={`Critical (> ${BAD_THRESHOLD_MS} ms)`}
          value={report.summary.badCount}
          tone={report.summary.badCount > 0 ? "err" : "default"}
        />
        <StatTile label="Slowest" value={`${Math.round(report.summary.slowestMs)} ms`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Slowest queries (top 10)</CardTitle>
          <p className="text-xs text-fg-muted">
            Queries above {WARN_THRESHOLD_MS} ms get a warning tint, above {BAD_THRESHOLD_MS} ms an
            error tint. If a slice you just shipped lands here, that's your next thing to fix.
          </p>
        </CardHeader>
        <CardContent>
          {report.slowest.length === 0 ? (
            <PageEmpty>No queries yet — make a request that hits the DB.</PageEmpty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Duration</TableHead>
                  <TableHead>SQL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.slowest.map((q, i) => (
                  <QueryRow key={i} q={q} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Most frequent templates (rough N+1 detector)</CardTitle>
          <p className="text-xs text-fg-muted">
            Templates that fire many times in a session usually mean a missing{" "}
            <code className="font-mono text-accent">include:</code> — the loop is round-tripping per
            row. The sample column shows the most recent occurrence so you can grep for it.
          </p>
        </CardHeader>
        <CardContent>
          {report.topTemplates.length === 0 ? (
            <PageEmpty>Empty buffer.</PageEmpty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Count</TableHead>
                  <TableHead className="w-28">Total</TableHead>
                  <TableHead>Sample</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.topTemplates.map((g) => (
                  <TableRow key={g.template}>
                    <TableCell
                      className={cn(
                        "font-mono tabular-nums",
                        g.count >= 10 ? "text-warn" : "text-fg",
                      )}
                    >
                      {g.count}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">{formatMs(g.totalMs)}</TableCell>
                    <TableCell className="break-all font-mono text-xs">{g.sample}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent (newest first, last 50)</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <PageEmpty>Empty buffer.</PageEmpty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Duration</TableHead>
                  <TableHead>SQL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((q, i) => (
                  <QueryRow key={i} q={q} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function QueryRow({ q }: { q: QueryRecord }): ReactNode {
  const tone =
    q.durationMs > BAD_THRESHOLD_MS
      ? "text-err"
      : q.durationMs > WARN_THRESHOLD_MS
        ? "text-warn"
        : "text-fg";
  return (
    <TableRow>
      <TableCell className={cn("font-mono tabular-nums", tone)}>{formatMs(q.durationMs)}</TableCell>
      <TableCell className="break-all font-mono text-xs">{q.sql}</TableCell>
    </TableRow>
  );
}
