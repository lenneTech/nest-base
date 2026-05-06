/**
 * `/dev/tests` — totals + per-file Vitest summary.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Badge } from "../components/ui/badge.js";
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
import { fetchJson, formatTestDuration } from "../lib/api.js";
import { cn } from "../lib/utils.js";

interface TotalShape {
  tests: number;
  passed: number;
  failed: number;
  durationMs: number;
  success: boolean;
}

interface TestFileRow {
  path: string;
  status: "passed" | "failed";
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failureSnippet?: string;
}

interface TestSummary {
  available: boolean;
  generatedAt?: string;
  totals: TotalShape;
  files: TestFileRow[];
}

export function TestsPage(): ReactNode {
  const data = useQuery({
    queryKey: ["dev", "tests"],
    queryFn: () => fetchJson<TestSummary>("/api/dev/tests.json"),
  });

  const subtitle = data.data
    ? data.data.available
      ? `Vitest ${data.data.totals.success ? "passed" : "failed"} — ${data.data.totals.passed}/${data.data.totals.tests} tests, ${formatTestDuration(data.data.totals.durationMs)}`
      : "Run `bun run test:summary` to populate this page."
    : "Loading…";

  return (
    <AdminShell title="Tests" subtitle={subtitle} currentNav="tests">
      {data.data ? (
        data.data.available ? (
          <TestsBody report={data.data} />
        ) : (
          <PageEmpty>
            Test summary not generated yet. Run{" "}
            <code className="font-mono text-accent">bun run test:summary</code> to populate the
            dashboard.
          </PageEmpty>
        )
      ) : data.isError ? (
        <PageError>Failed to load test summary.</PageError>
      ) : (
        <PageLoading>Loading test summary…</PageLoading>
      )}
    </AdminShell>
  );
}

function TestsBody({ report }: { report: TestSummary }): ReactNode {
  const t = report.totals;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Totals</CardTitle>
          {t.success ? (
            <Badge variant="ok">✓ all green</Badge>
          ) : (
            <Badge variant="err">✗ failures</Badge>
          )}
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Tests" value={t.tests} />
          <StatTile label="Passed" value={t.passed} tone="ok" />
          <StatTile label="Failed" value={t.failed} tone={t.failed > 0 ? "err" : "default"} />
          <StatTile label="Duration" value={formatTestDuration(t.durationMs)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files ({report.files.length}, failures first)</CardTitle>
        </CardHeader>
        <CardContent>
          {report.files.length === 0 ? (
            <PageEmpty>No file-level data in summary.</PageEmpty>
          ) : (
            <div className="max-h-[65dvh] min-h-56 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Pass</TableHead>
                    <TableHead>Fail</TableHead>
                    <TableHead>Skip</TableHead>
                    <TableHead>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.files.map((file) => (
                    <TableRow
                      key={file.path}
                      className={cn(file.status === "failed" && "bg-err/5")}
                    >
                      <TableCell>
                        <Badge variant={file.status === "passed" ? "ok" : "err"}>
                          {file.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <code className="font-mono text-xs">{file.path}</code>
                        {file.failureSnippet ? (
                          <pre className="mt-2 rounded bg-surface-3 p-2 text-[0.7rem] text-err whitespace-pre-wrap">
                            {file.failureSnippet}
                          </pre>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-ok">
                        {file.passed}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-err">
                        {file.failed}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-fg-muted">
                        {file.skipped}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {formatTestDuration(file.durationMs)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
