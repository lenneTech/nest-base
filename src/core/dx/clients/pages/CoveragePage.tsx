/**
 * `/dev/coverage` — coverage totals + per-file table. Same data the
 * server's `coverage-ui.ts` rendered; the layer is now Tailwind +
 * shadcn primitives.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Badge } from "../components/ui/badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Progress } from "../components/ui/progress.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.js";
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";
import { cn } from "../lib/utils.js";

interface Bucket {
  pct: number;
  total?: number;
  covered?: number;
  skipped?: number;
}
interface FileRow {
  path: string;
  tier: "core" | "modules" | "shared" | "other";
  metrics: { lines: Bucket; statements: Bucket; branches: Bucket; functions: Bucket };
  meetsThreshold: boolean;
}
interface CoverageReport {
  available: boolean;
  generatedAt?: string;
  total?: { lines: Bucket; statements: Bucket; branches: Bucket; functions: Bucket };
  files: FileRow[];
  thresholds: { core: number; modules: number; shared: number };
  gate: { coreOk: boolean; modulesOk: boolean; overallOk: boolean };
}

export function CoveragePage(): ReactNode {
  const data = useQuery({
    queryKey: ["dev", "coverage"],
    queryFn: () => fetchJson<CoverageReport>("/dev/coverage.json"),
  });

  const subtitle = data.data
    ? data.data.available
      ? `Vitest + V8 — generated ${data.data.generatedAt ?? ""}`
      : "Run `bun run test:coverage` to populate this page."
    : "Loading…";

  return (
    <AdminShell title="Coverage" subtitle={subtitle} currentNav="coverage">
      {data.data ? (
        data.data.available ? (
          <CoverageBody report={data.data} />
        ) : (
          <PageEmpty>
            Coverage report not generated yet. Run <code className="font-mono text-accent">bun run test:coverage</code> to populate the dashboard.
          </PageEmpty>
        )
      ) : data.isError ? (
        <PageError>Failed to load coverage report.</PageError>
      ) : (
        <PageLoading>Loading coverage report…</PageLoading>
      )}
    </AdminShell>
  );
}

function CoverageBody({ report }: { report: CoverageReport }): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Totals</CardTitle>
          <div className="flex gap-2">
            <GateBadge label={`Core ≥ ${report.thresholds.core}%`} ok={report.gate.coreOk} />
            <GateBadge label={`Modules ≥ ${report.thresholds.modules}%`} ok={report.gate.modulesOk} />
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Lines" pct={report.total?.lines.pct} />
          <Tile label="Statements" pct={report.total?.statements.pct} />
          <Tile label="Branches" pct={report.total?.branches.pct} />
          <Tile label="Functions" pct={report.total?.functions.pct} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files ({report.files.length}, worst first)</CardTitle>
        </CardHeader>
        <CardContent>
          {report.files.length === 0 ? (
            <PageEmpty>No file-level coverage data.</PageEmpty>
          ) : (
            <div className="max-h-[65dvh] min-h-56 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Lines</TableHead>
                    <TableHead>Stmts</TableHead>
                    <TableHead>Branches</TableHead>
                    <TableHead>Funcs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.files.map((file) => (
                    <FileRowView key={file.path} file={file} />
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

function Tile({ label, pct }: { label: string; pct?: number }): ReactNode {
  const value = pct === undefined ? "—" : `${pct.toFixed(2)}%`;
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct ?? 0)) : 0;
  const tone = safePct >= 90 ? "text-ok" : safePct >= 70 ? "text-warn" : "text-err";
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-4">
      <div className="text-[0.65rem] font-semibold uppercase tracking-widest text-fg-faint">
        {label}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums", tone)}>{value}</div>
      <Progress className="mt-3" value={safePct} />
    </div>
  );
}

function GateBadge({ label, ok }: { label: string; ok: boolean }): ReactNode {
  return (
    <Badge variant={ok ? "ok" : "err"}>
      {ok ? "✓" : "✗"} {label}
    </Badge>
  );
}

function FileRowView({ file }: { file: FileRow }): ReactNode {
  return (
    <TableRow data-below-threshold={!file.meetsThreshold ? "true" : undefined}>
      <TableCell>
        <code className="font-mono text-xs text-fg">{file.path}</code>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="text-[0.65rem] uppercase">
          {file.tier}
        </Badge>
      </TableCell>
      <TableCell>{pctCell(file.metrics.lines.pct, file.tier)}</TableCell>
      <TableCell>{pctCell(file.metrics.statements.pct, file.tier)}</TableCell>
      <TableCell>{pctCell(file.metrics.branches.pct, file.tier)}</TableCell>
      <TableCell>{pctCell(file.metrics.functions.pct, file.tier)}</TableCell>
    </TableRow>
  );
}

function pctCell(pct: number, tier: FileRow["tier"]): ReactNode {
  const value = `${pct.toFixed(2)}%`;
  const target = tier === "core" ? 90 : tier === "modules" ? 80 : 0;
  const tone = pct >= target ? "text-ok" : pct >= target - 10 ? "text-warn" : "text-err";
  return <span className={cn("font-mono text-xs tabular-nums", tone)}>{value}</span>;
}
