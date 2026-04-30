/**
 * `/dev/diagnostics` — verbatim React port of `diagnostics-ui.ts`.
 * Same Runtime + Environment two-column grid, same heap pressure bar
 * (clamped to [0, 100]% so JSC's brief over-commit doesn't break the
 * layout), same "Active features" 3-column grid + application-meta
 * card.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, formatBytes, formatDuration } from "../lib/api.js";

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
    queryFn: () => fetchJson<DiagnosticsReport>("/dev/diagnostics.json"),
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
        <div className="admin-empty">Failed to load diagnostics.</div>
      ) : (
        <div className="admin-empty">Loading diagnostics…</div>
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

  const heapFillCls =
    heapPct > 90 ? "diag-bar__fill--bad" : heapPct > 70 ? "diag-bar__fill--warn" : "";

  return (
    <>
      <div className="diag-grid">
        <div className="diag-card">
          <h3 className="diag-card__title">Runtime</h3>
          <div className="diag-bar-wrap">
            <div className="diag-bar-row">
              <span>Heap pressure</span>
              <span>
                {formatBytes(heap.heapUsed)} / {formatBytes(heap.heapTotal)} ({heapPct}%)
              </span>
            </div>
            <div className="diag-bar">
              <div className={`diag-bar__fill ${heapFillCls}`} style={{ width: `${heapPct}%` }} />
            </div>
          </div>
          <Row label="Heap used" value={formatBytes(heap.heapUsed)} />
          <Row label="Heap committed" value={formatBytes(heap.heapTotal)} />
          {heapOverflow ? (
            <div className="diag-row" style={{ borderBottom: 0, padding: "0.35rem 0 0" }}>
              <span
                className="diag-row__label"
                style={{ fontSize: "0.72rem", color: "var(--fg-dim)" }}
              >
                Heap used &gt; committed — Bun's JSC heap accounting can show this briefly. Not a
                leak.
              </span>
            </div>
          ) : null}
          <Row label="RSS" value={formatBytes(heap.rss)} />
          <Row label="External" value={formatBytes(heap.external)} />
          <Row label="Array Buffers" value={formatBytes(heap.arrayBuffers)} />
          <Row label="Uptime" value={formatDuration(uptimeMs)} />
        </div>

        <div className="diag-card">
          <h3 className="diag-card__title">Environment</h3>
          <Row
            label="App env"
            value={
              <span className="diag-row__value">
                <span className="diag-pill">{report.app.env}</span>
              </span>
            }
            valueIsNode
          />
          <Row label="Version" value={report.app.version} />
          <Row label="Base URL" value={report.app.baseUrl} />
          <Row label="Node" value={report.runtime.nodeVersion} />
          {report.runtime.bunVersion ? <Row label="Bun" value={report.runtime.bunVersion} /> : null}
          <Row label="Platform" value={`${report.runtime.platform} / ${report.runtime.arch}`} />
        </div>
      </div>

      <div className="admin-card" style={{ marginTop: "1.25rem" }}>
        <h3 className="diag-card__title">Active features</h3>
        <div className="diag-grid diag-grid--3">
          {Object.entries(report.features)
            .filter(([k]) => k !== "authMethods" && k !== "socialProviders")
            .map(([k, v]) => {
              const isOn = Boolean(v);
              return (
                <div key={k} className="diag-row">
                  <span className="diag-row__label">{k}</span>
                  <span className="diag-row__value">
                    <span className={`diag-pill${isOn ? "" : " diag-pill--off"}`}>
                      {isOn ? "ON" : "OFF"}
                    </span>
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      <div className="admin-card" style={{ marginTop: "1.25rem" }}>
        <h3 className="diag-card__title">Application metadata</h3>
        {Object.entries(report.dependencies).map(([k, v]) => (
          <Row key={k} label={k} value={String(v)} />
        ))}
        <Row label="Generated" value={report.process.now} />
      </div>
    </>
  );
}

function Row({
  label,
  value,
  valueIsNode = false,
}: {
  label: string;
  value: ReactNode;
  valueIsNode?: boolean;
}): ReactNode {
  return (
    <div className="diag-row">
      <span className="diag-row__label">{label}</span>
      {valueIsNode ? value : <span className="diag-row__value">{value}</span>}
    </div>
  );
}
