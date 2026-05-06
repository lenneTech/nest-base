/**
 * `/dev/diagnostics` — runtime + environment + active features +
 * application metadata.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Badge } from "../components/ui/badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Progress } from "../components/ui/progress.js";
import { PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, formatBytes, formatDuration } from "../lib/api.js";
import { cn } from "../lib/utils.js";

interface MemorySnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}
interface DiagnosticsReport {
  app: { env: string; version: string; baseUrl: string };
  runtime: { nodeVersion: string; bunVersion?: string; platform: string; arch: string };
  process: { uptimeSeconds: number; now: string; memory: MemorySnapshot };
  features: Record<string, unknown>;
  dependencies: Record<string, string>;
}

export function DiagnosticsPage(): ReactNode {
  const data = useQuery({
    queryKey: ["dev", "diagnostics"],
    queryFn: () => fetchJson<DiagnosticsReport>("/api/hub/diagnostics.json"),
    refetchInterval: 5_000,
  });

  return (
    <AdminShell
      title="Diagnostics"
      subtitle="Live runtime, memory, environment, and feature roster."
      currentNav="diagnostics"
    >
      {data.data ? (
        <DiagnosticsBody report={data.data} />
      ) : data.isError ? (
        <PageError>Failed to load diagnostics.</PageError>
      ) : (
        <PageLoading>Loading diagnostics…</PageLoading>
      )}
    </AdminShell>
  );
}

function DiagnosticsBody({ report }: { report: DiagnosticsReport }): ReactNode {
  const heap = report.process.memory;
  // See `diagnostics-ui.ts` — clamp so JSC's transient
  // heapUsed > heapTotal doesn't blow up the bar.
  const heapDenominator = Math.max(heap.heapUsed, heap.heapTotal);
  const heapPct =
    heapDenominator > 0 ? Math.min(100, Math.round((heap.heapUsed / heapDenominator) * 100)) : 0;
  const heapOverflow = heap.heapUsed > heap.heapTotal && heap.heapTotal > 0;
  const uptimeMs = report.process.uptimeSeconds * 1000;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Runtime</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div>
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span>Heap pressure</span>
                <span className="font-mono tabular-nums">
                  {formatBytes(heap.heapUsed)} / {formatBytes(heap.heapTotal)} ({heapPct}%)
                </span>
              </div>
              <Progress
                value={heapPct}
                className={cn(
                  "mt-2",
                  heapPct > 90
                    ? "[&>div]:bg-err"
                    : heapPct > 70
                      ? "[&>div]:bg-warn"
                      : "[&>div]:bg-accent",
                )}
              />
            </div>
            <Row label="Heap used" value={formatBytes(heap.heapUsed)} />
            <Row label="Heap committed" value={formatBytes(heap.heapTotal)} />
            {heapOverflow ? (
              <p className="text-xs text-fg-dim">
                Heap used &gt; committed — Bun's JSC heap accounting can show this briefly. Not a
                leak.
              </p>
            ) : null}
            <Row label="RSS" value={formatBytes(heap.rss)} />
            <Row label="External" value={formatBytes(heap.external)} />
            <Row label="Array Buffers" value={formatBytes(heap.arrayBuffers)} />
            <Row label="Uptime" value={formatDuration(uptimeMs)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Environment</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Row
              label="App env"
              value={
                <Badge variant="info" className="uppercase">
                  {report.app.env}
                </Badge>
              }
            />
            <Row label="Version" value={report.app.version} />
            <Row label="Base URL" value={report.app.baseUrl} />
            <Row label="Node" value={report.runtime.nodeVersion} />
            {report.runtime.bunVersion ? (
              <Row label="Bun" value={report.runtime.bunVersion} />
            ) : null}
            <Row label="Platform" value={`${report.runtime.platform} / ${report.runtime.arch}`} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active features</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Object.entries(report.features)
            .filter(([k]) => k !== "authMethods" && k !== "socialProviders")
            .map(([k, v]) => {
              const isOn = Boolean(v);
              return (
                <div
                  key={k}
                  className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm"
                >
                  <span className="font-mono text-xs text-fg-muted">{k}</span>
                  <Badge variant={isOn ? "ok" : "secondary"}>{isOn ? "ON" : "OFF"}</Badge>
                </div>
              );
            })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Application metadata</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {Object.entries(report.dependencies).map(([k, v]) => (
            <Row key={k} label={k} value={String(v)} />
          ))}
          <Row label="Generated" value={report.process.now} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/50 pb-2 last:border-0 last:pb-0">
      <span className="text-xs uppercase tracking-wider text-fg-dim">{label}</span>
      <span className="font-mono text-xs text-fg">{value}</span>
    </div>
  );
}
