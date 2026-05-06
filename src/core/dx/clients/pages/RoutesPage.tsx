/**
 * `/dev/routes` — route inventory: 5-tile summary + per-route table.
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
import { PageError, PageLoading, StatTile } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";
import { cn } from "../lib/utils.js";

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
    queryFn: () => fetchJson<RouteInventory>("/api/hub/routes.json"),
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
        <PageError>Failed to load route inventory.</PageError>
      ) : (
        <PageLoading>Loading routes…</PageLoading>
      )}
    </AdminShell>
  );
}

function renderSubtitle(total: number, unguarded: number): ReactNode {
  return (
    <>
      {total} endpoint(s) registered. <strong className="text-err">{unguarded} unguarded</strong> —
      review the policy.
    </>
  );
}

function RoutesBody({ inventory }: { inventory: RouteInventory }): ReactNode {
  const summary = inventory.summary;
  const tilePct = (n: number): number =>
    summary.total === 0 ? 0 : Math.round((n / summary.total) * 100);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Total" value={summary.total} />
        <StatTile
          label="Guarded (@Can)"
          value={summary.guarded}
          hint={`${tilePct(summary.guarded)}%`}
          tone="ok"
        />
        <StatTile
          label="Public"
          value={summary.public}
          hint={`${tilePct(summary.public)}%`}
          tone="info"
        />
        <StatTile label="Dev-only" value={summary.devOnly} hint={`${tilePct(summary.devOnly)}%`} />
        <StatTile
          label="Unguarded"
          value={summary.unguarded}
          hint={`${tilePct(summary.unguarded)}%`}
          tone={summary.unguarded > 0 ? "err" : "default"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All routes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[65dvh] min-h-56 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Controller</TableHead>
                  <TableHead>Handler</TableHead>
                  <TableHead>Guard</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventory.routes.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <MethodBadge method={r.method} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.path}</TableCell>
                    <TableCell className="text-xs text-fg-muted">{r.controller}</TableCell>
                    <TableCell className="text-xs text-fg-muted">{r.handler}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.guards.map((g, j) => (
                          <GuardBadge key={j} guard={g} />
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MethodBadge({ method }: { method: string }): ReactNode {
  const palette: Record<string, string> = {
    GET: "bg-accent-soft text-accent",
    POST: "bg-ok/15 text-ok",
    PUT: "bg-warn/15 text-warn",
    PATCH: "bg-warn/15 text-warn",
    DELETE: "bg-err/15 text-err",
  };
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold",
        palette[method] ?? "bg-surface-3 text-fg-muted",
      )}
    >
      {method}
    </span>
  );
}

function GuardBadge({ guard }: { guard: RouteGuard }): ReactNode {
  if (guard.kind === "can") {
    return (
      <Badge variant="ok" className="font-mono text-[0.65rem]">
        @Can({guard.action}, {guard.subject})
      </Badge>
    );
  }
  if (guard.kind === "public")
    return (
      <Badge variant="info" className="font-mono text-[0.65rem]">
        public
      </Badge>
    );
  if (guard.kind === "dev-only")
    return (
      <Badge variant="secondary" className="font-mono text-[0.65rem]">
        dev-only
      </Badge>
    );
  return (
    <Badge variant="err" className="font-mono text-[0.65rem]">
      unguarded
    </Badge>
  );
}
