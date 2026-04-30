/**
 * `/dev/queries` — verbatim React port of `query-viewer-ui.ts`. Same
 * 4-tile summary, same three sections (slowest top-10, top templates,
 * recent newest-first up-to-50). Same warning thresholds.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, formatMs } from "../lib/api.js";

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
    queryKey: ["dev", "queries"],
    queryFn: () => fetchJson<QueriesResponse>("/dev/queries.json"),
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
        <div className="admin-empty">Failed to load queries.</div>
      ) : (
        <div className="admin-empty">Loading queries…</div>
      )}
    </AdminShell>
  );
}

function QueriesBody({ report }: { report: QueriesResponse }): ReactNode {
  const recent = report.recent.slice().reverse().slice(0, 50);
  return (
    <>
      <div className="qv-tiles">
        <div className="qv-tile">
          <div className="qv-tile__title">Total queries</div>
          <div className="qv-tile__value">{report.summary.total}</div>
        </div>
        <div className={`qv-tile${report.summary.warnCount > 0 ? " qv-tile--warn" : ""}`}>
          <div className="qv-tile__title">Slow (&gt; {WARN_THRESHOLD_MS} ms)</div>
          <div className="qv-tile__value">{report.summary.warnCount}</div>
        </div>
        <div className={`qv-tile${report.summary.badCount > 0 ? " qv-tile--bad" : ""}`}>
          <div className="qv-tile__title">Critical (&gt; {BAD_THRESHOLD_MS} ms)</div>
          <div className="qv-tile__value">{report.summary.badCount}</div>
        </div>
        <div className="qv-tile">
          <div className="qv-tile__title">Slowest</div>
          <div className="qv-tile__value">{Math.round(report.summary.slowestMs)} ms</div>
        </div>
      </div>

      <section className="qv-section">
        <h2>Slowest queries (top 10)</h2>
        <p className="qv-section__hint">
          Queries above {WARN_THRESHOLD_MS} ms get a warning tint, above {BAD_THRESHOLD_MS} ms an
          error tint. If a slice you just shipped lands here, that's your next thing to fix.
        </p>
        {report.slowest.length === 0 ? (
          <div className="qv-empty">No queries yet — make a request that hits the DB.</div>
        ) : (
          <table className="qv-table">
            <colgroup>
              <col style={{ width: "7rem" }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th className="qv-num">Duration</th>
                <th>SQL</th>
              </tr>
            </thead>
            <tbody>
              {report.slowest.map((q, i) => (
                <QueryRow key={i} q={q} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="qv-section">
        <h2>Most frequent templates (rough N+1 detector)</h2>
        <p className="qv-section__hint">
          Templates that fire many times in a session usually mean a missing <code>include:</code> —
          the loop is round-tripping per row. The sample column shows the most recent occurrence so
          you can grep for it.
        </p>
        {report.topTemplates.length === 0 ? (
          <div className="qv-empty">Empty buffer.</div>
        ) : (
          <table className="qv-table">
            <colgroup>
              <col style={{ width: "5rem" }} />
              <col style={{ width: "7rem" }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th className="qv-num">Count</th>
                <th className="qv-num">Total</th>
                <th>Sample</th>
              </tr>
            </thead>
            <tbody>
              {report.topTemplates.map((g) => (
                <tr key={g.template}>
                  <td className={`qv-num${g.count >= 10 ? " qv-count--high" : ""}`}>{g.count}</td>
                  <td className="qv-num">{formatMs(g.totalMs)}</td>
                  <td className="qv-sql">{g.sample}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="qv-section">
        <h2>Recent (newest first, last 50)</h2>
        {recent.length === 0 ? (
          <div className="qv-empty">Empty buffer.</div>
        ) : (
          <table className="qv-table">
            <colgroup>
              <col style={{ width: "7rem" }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th className="qv-num">Duration</th>
                <th>SQL</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((q, i) => (
                <QueryRow key={i} q={q} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function QueryRow({ q }: { q: QueryRecord }): ReactNode {
  const dc =
    q.durationMs > BAD_THRESHOLD_MS
      ? "qv-dur--bad"
      : q.durationMs > WARN_THRESHOLD_MS
        ? "qv-dur--slow"
        : "";
  return (
    <tr>
      <td className={`qv-num ${dc}`}>{formatMs(q.durationMs)}</td>
      <td className="qv-sql">{q.sql}</td>
    </tr>
  );
}
