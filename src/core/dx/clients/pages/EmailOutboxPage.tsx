/**
 * `/dev/email-outbox` — email-outbox dashboard (issue #11). Surfaces
 * the same JSON the legacy `/dev/outbox.json` endpoint produced, with
 * a card per dispatchable record + lag classification + counters.
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
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

interface EmailOutboxRecord {
  id: string;
  kind: string;
  status: string;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  idempotencyKey: string | null;
  createdAt: string;
}

interface EmailOutboxJson {
  enabled: boolean;
  message?: string;
  health?: { level: "ok" | "warn" | "crit"; pendingCount: number; oldestAgeMs: number | null };
  dispatchable?: EmailOutboxRecord[];
}

function StatusBadge({ status }: { status: string }): ReactNode {
  const tone =
    status === "SENT"
      ? "bg-ok/15 text-ok"
      : status === "FAILED"
        ? "bg-err/15 text-err"
        : "bg-warn/15 text-warn";
  return <Badge className={tone}>{status}</Badge>;
}

function HealthBadge({ level }: { level: "ok" | "warn" | "crit" }): ReactNode {
  const tone =
    level === "ok"
      ? "bg-ok/15 text-ok"
      : level === "warn"
        ? "bg-warn/15 text-warn"
        : "bg-err/15 text-err";
  return <Badge className={tone}>{level.toUpperCase()}</Badge>;
}

export function EmailOutboxPage(): ReactNode {
  const query = useQuery({
    queryKey: ["dev", "email-outbox"],
    queryFn: () => fetchJson<EmailOutboxJson>("/api/hub/outbox.json"),
    refetchInterval: 5_000,
  });

  return (
    <AdminShell
      title="Email Outbox"
      subtitle="Pending mail dispatch state"
      currentNav="email-outbox"
    >
      {query.isPending ? (
        <PageLoading>Loading email-outbox state…</PageLoading>
      ) : query.isError ? (
        <PageError>Failed to load /dev/outbox.json</PageError>
      ) : query.data?.enabled === false ? (
        <PageEmpty>{query.data?.message ?? "Email-outbox storage is not wired."}</PageEmpty>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Lag</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-4 text-sm">
              <HealthBadge level={query.data?.health?.level ?? "ok"} />
              <span>
                Pending:{" "}
                <strong className="text-fg">{query.data?.health?.pendingCount ?? 0}</strong>
              </span>
              <span>
                Oldest age (ms):{" "}
                <strong className="text-fg">{query.data?.health?.oldestAgeMs ?? 0}</strong>
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Dispatchable ({query.data?.dispatchable?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {(query.data?.dispatchable ?? []).length === 0 ? (
                <PageEmpty>No dispatchable rows — the queue is drained.</PageEmpty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Next attempt</TableHead>
                      <TableHead>Last error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(query.data?.dispatchable ?? []).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">{row.id}</TableCell>
                        <TableCell>{row.kind}</TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} />
                        </TableCell>
                        <TableCell>{row.attemptCount}</TableCell>
                        <TableCell className="text-xs text-fg-muted">
                          {row.nextAttemptAt ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-err">{row.lastError ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AdminShell>
  );
}
