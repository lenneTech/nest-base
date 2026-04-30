/**
 * `/dev/routes` — verbatim React port of `route-inventory-ui.ts`.
 * Same 5-tile summary (total / guarded / public / dev-only /
 * unguarded with %), same per-route table.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

type RouteGuard =
  | { kind: "can"; action: string; subject: string }
  | { kind: "public" }
  | { kind: "dev-only" }
  | { kind: "unguarded" };

interface RouteRecord {
  method: string;
  path: string;
  controller: string;
  handler: string;
  guards: RouteGuard[];
}

interface RouteInventory {
  routes: RouteRecord[];
  summary: {
    total: number;
    guarded: number;
    public: number;
    devOnly: number;
    unguarded: number;
  };
}

export function RoutesPage(): ReactNode {
  const data = useQuery({
    queryKey: ["dev", "routes"],
    queryFn: () => fetchJson<RouteInventory>("/dev/routes.json"),
  });

  const subtitle = data.data
    ? data.data.summary.unguarded > 0
      ? renderSubtitle(data.data.summary.total, data.data.summary.unguarded)
      : `${data.data.summary.total} endpoint(s) registered. All routes accounted for.`
    : "Loading…";

  return (
    <AdminShell title="Routes" subtitle={subtitle} currentNav="routes">
      {data.data ? (
        <RoutesBody inventory={data.data} />
      ) : data.isError ? (
        <div className="admin-empty">Failed to load route inventory.</div>
      ) : (
        <div className="admin-empty">Loading routes…</div>
      )}
    </AdminShell>
  );
}

function renderSubtitle(total: number, unguarded: number): ReactNode {
  return (
    <>
      {total} endpoint(s) registered.{" "}
      <strong style={{ color: "var(--err)" }}>{unguarded} unguarded</strong> — review the policy.
    </>
  );
}

function RoutesBody({ inventory }: { inventory: RouteInventory }): ReactNode {
  const summary = inventory.summary;
  const tilePct = (n: number): number =>
    summary.total === 0 ? 0 : Math.round((n / summary.total) * 100);

  return (
    <>
      <div className="ri-tiles">
        <div className="ri-tile">
          <div className="ri-tile__title">Total</div>
          <div className="ri-tile__value">{summary.total}</div>
        </div>
        <div className="ri-tile ri-tile--ok">
          <div className="ri-tile__title">Guarded (@Can)</div>
          <div className="ri-tile__value">
            {summary.guarded} <span className="ri-tile__pct">{tilePct(summary.guarded)}%</span>
          </div>
        </div>
        <div className="ri-tile ri-tile--info">
          <div className="ri-tile__title">Public</div>
          <div className="ri-tile__value">
            {summary.public} <span className="ri-tile__pct">{tilePct(summary.public)}%</span>
          </div>
        </div>
        <div className="ri-tile ri-tile--devonly">
          <div className="ri-tile__title">Dev-only</div>
          <div className="ri-tile__value">
            {summary.devOnly} <span className="ri-tile__pct">{tilePct(summary.devOnly)}%</span>
          </div>
        </div>
        <div className={`ri-tile${summary.unguarded > 0 ? " ri-tile--bad" : ""}`}>
          <div className="ri-tile__title">Unguarded</div>
          <div className="ri-tile__value">
            {summary.unguarded} <span className="ri-tile__pct">{tilePct(summary.unguarded)}%</span>
          </div>
        </div>
      </div>

      <table className="ri-table">
        <thead>
          <tr>
            <th>Method</th>
            <th>Path</th>
            <th>Controller</th>
            <th>Handler</th>
            <th>Guard</th>
          </tr>
        </thead>
        <tbody>
          {inventory.routes.map((r, i) => (
            <tr key={i}>
              <td>
                <span className={`ri-method ri-method--${r.method}`}>{r.method}</span>
              </td>
              <td>{r.path}</td>
              <td>{r.controller}</td>
              <td>{r.handler}</td>
              <td>
                {r.guards.map((g, j) => (
                  <GuardBadge key={j} guard={g} />
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function GuardBadge({ guard }: { guard: RouteGuard }): ReactNode {
  if (guard.kind === "can") {
    return (
      <span className="ri-guard ri-guard--can">
        @Can({guard.action}, {guard.subject})
      </span>
    );
  }
  if (guard.kind === "public") return <span className="ri-guard ri-guard--public">public</span>;
  if (guard.kind === "dev-only")
    return <span className="ri-guard ri-guard--devonly">dev-only</span>;
  return <span className="ri-guard ri-guard--unguarded">unguarded</span>;
}
