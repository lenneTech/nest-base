/**
 * `/dev/coverage` — verbatim React port of `coverage-ui.ts`. Same
 * 4-tile totals (lines / statements / branches / functions) with
 * progress bars, same gate badges, same files table sorted
 * worst-first inside a sticky-header scroll container.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

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
          <div className="admin-empty">
            Coverage report not generated yet.
            <br />
            Run <code>bun run test:coverage</code> to populate the dashboard.
          </div>
        )
      ) : data.isError ? (
        <div className="admin-empty">Failed to load coverage report.</div>
      ) : (
        <div className="admin-empty">Loading coverage report…</div>
      )}
    </AdminShell>
  );
}

function CoverageBody({ report }: { report: CoverageReport }): ReactNode {
  return (
    <>
      <div className="admin-card">
        <h2 className="admin-card__title">
          Totals
          <GateBadge label={`Core ≥ ${report.thresholds.core}%`} ok={report.gate.coreOk} />
          <GateBadge label={`Modules ≥ ${report.thresholds.modules}%`} ok={report.gate.modulesOk} />
        </h2>
        <div className="cov-totals">
          <Tile label="Lines" pct={report.total?.lines.pct} />
          <Tile label="Statements" pct={report.total?.statements.pct} />
          <Tile label="Branches" pct={report.total?.branches.pct} />
          <Tile label="Functions" pct={report.total?.functions.pct} />
        </div>
      </div>

      <div className="admin-card">
        <h2 className="admin-card__title">Files ({report.files.length}, schlechteste oben)</h2>
        {report.files.length === 0 ? (
          <div className="admin-empty">No file-level coverage data.</div>
        ) : (
          <div className="cov-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Tier</th>
                  <th>Lines</th>
                  <th>Stmts</th>
                  <th>Branches</th>
                  <th>Funcs</th>
                </tr>
              </thead>
              <tbody>
                {report.files.map((file) => (
                  <FileRowView key={file.path} file={file} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Tile({ label, pct }: { label: string; pct?: number }): ReactNode {
  const value = pct === undefined ? "—" : `${pct.toFixed(2)}%`;
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct ?? 0)) : 0;
  const cls =
    safePct >= 90
      ? "cov-tile__fill--ok"
      : safePct >= 70
        ? "cov-tile__fill--warn"
        : "cov-tile__fill--bad";
  return (
    <div className="cov-tile">
      <div className="cov-tile__label">{label}</div>
      <div className="cov-tile__value">{value}</div>
      <div className="cov-tile__bar">
        <div className={`cov-tile__fill ${cls}`} style={{ width: `${safePct}%` }} />
      </div>
    </div>
  );
}

function GateBadge({ label, ok }: { label: string; ok: boolean }): ReactNode {
  return (
    <span className={`cov-gate ${ok ? "cov-gate--ok" : "cov-gate--bad"}`}>
      {ok ? "✓" : "✗"} {label}
    </span>
  );
}

function FileRowView({ file }: { file: FileRow }): ReactNode {
  return (
    <tr {...(!file.meetsThreshold ? { "data-below-threshold": "true" } : {})}>
      <td>
        <code>{file.path}</code>
      </td>
      <td>
        <span className="cov-tier">{file.tier}</span>
      </td>
      <td>{pctCell(file.metrics.lines.pct, file.tier)}</td>
      <td>{pctCell(file.metrics.statements.pct, file.tier)}</td>
      <td>{pctCell(file.metrics.branches.pct, file.tier)}</td>
      <td>{pctCell(file.metrics.functions.pct, file.tier)}</td>
    </tr>
  );
}

function pctCell(pct: number, tier: FileRow["tier"]): ReactNode {
  const value = `${pct.toFixed(2)}%`;
  const target = tier === "core" ? 90 : tier === "modules" ? 80 : 0;
  const cls = pct >= target ? "cov-pct--ok" : pct >= target - 10 ? "cov-pct--warn" : "cov-pct--bad";
  return <span className={`cov-pct ${cls}`}>{value}</span>;
}
