/**
 * `/hub/admin/audit` — filter + inspect tenant-scoped audit-log entries
 * with before / after diffs.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
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
import { bootstrapHubOperatorSession } from "../lib/hub-session-bootstrap.js";

interface AuditLogEntry {
  id: string;
  action: string;
  resource: string;
  resourceId?: string;
  actorUserId?: string;
  tenantId?: string;
  occurredAt: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

interface AuditBrowserFilter {
  action?: string;
  resource?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
}

interface AuditBrowserResponse {
  entries: AuditLogEntry[];
  filter: AuditBrowserFilter;
}

export function AuditBrowserPage(): ReactNode {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const filter: AuditBrowserFilter = {};
  for (const key of ["action", "resource", "actorUserId", "from", "to"] as const) {
    const v = params.get(key);
    if (v) filter[key] = v;
  }

  const [tenantId, setTenantId] = useState("");
  const [tenantBootstrapDone, setTenantBootstrapDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const bootstrapped = await bootstrapHubOperatorSession();
      if (!cancelled && bootstrapped) setTenantId(bootstrapped);
      if (!cancelled) setTenantBootstrapDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const url = `/hub/admin/audit.json?${params.toString()}`;
  const data = useQuery({
    queryKey: ["admin", "audit", url, tenantId],
    queryFn: () => fetchJson<AuditBrowserResponse>(url),
    enabled: tenantBootstrapDone && tenantId.trim().length > 0,
  });

  return (
    <AdminShell
      title="Audit Browser"
      subtitle="Filter tenant-scoped audit entries and show diffs."
      currentNav="audit"
    >
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Filter</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6"
              method="get"
              action="/hub/admin/audit"
            >
              <FilterField
                label="Action"
                name="action"
                hint="create / update / delete"
                defaultValue={filter.action ?? ""}
              />
              <FilterField
                label="Resource"
                name="resource"
                hint="Project"
                defaultValue={filter.resource ?? ""}
              />
              <FilterField
                label="Actor"
                name="actorUserId"
                hint="user uuid"
                defaultValue={filter.actorUserId ?? ""}
              />
              <FilterField label="From" name="from" type="date" defaultValue={filter.from ?? ""} />
              <FilterField label="To" name="to" type="date" defaultValue={filter.to ?? ""} />
              <Button type="submit" className="self-end">
                Filter
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Entries</CardTitle>
          </CardHeader>
          <CardContent>
            <EntriesTable
              entries={data.data?.entries}
              isError={data.isError}
              tenantMissing={tenantBootstrapDone && tenantId.trim().length === 0}
              tenantLoading={!tenantBootstrapDone}
            />
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}

function FilterField({
  label,
  name,
  hint,
  defaultValue,
  type,
}: {
  label: string;
  name: string;
  hint?: string;
  defaultValue: string;
  type?: string;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} placeholder={hint} defaultValue={defaultValue} />
    </div>
  );
}

function EntriesTable({
  entries,
  isError,
  tenantMissing,
  tenantLoading,
}: {
  entries: AuditLogEntry[] | undefined;
  isError: boolean;
  tenantMissing: boolean;
  tenantLoading: boolean;
}): ReactNode {
  if (tenantLoading) {
    return <PageLoading>Loading tenant from session…</PageLoading>;
  }
  if (tenantMissing) {
    return (
      <PageError>
        No active organization in session. Sign in to the Hub and call set-active, or pick a default
        org via bootstrap.
      </PageError>
    );
  }
  if (isError) return <PageError>Failed to load audit entries.</PageError>;
  if (!entries) return <PageLoading>Loading…</PageLoading>;
  if (entries.length === 0)
    return <PageEmpty>No audit entries match the current filter.</PageEmpty>;
  return (
    <Table data-audit-entries="true">
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Resource</TableHead>
          <TableHead>ID</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Diff</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const tone =
            entry.action === "delete"
              ? "err"
              : entry.action === "create"
                ? "ok"
                : entry.action === "update"
                  ? "info"
                  : "secondary";
          return (
            <TableRow key={entry.id} data-action={entry.action}>
              <TableCell className="font-mono text-[0.7rem] text-fg-muted">
                {entry.occurredAt}
              </TableCell>
              <TableCell>
                <Badge variant={tone}>{entry.action}</Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">{entry.resource}</TableCell>
              <TableCell className="font-mono text-[0.7rem] text-fg-muted">
                {entry.resourceId ?? ""}
              </TableCell>
              <TableCell className="font-mono text-[0.7rem] text-fg-muted">
                {entry.actorUserId ?? ""}
              </TableCell>
              <TableCell>
                <DiffCell before={entry.before} after={entry.after} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function DiffCell({
  before,
  after,
}: {
  before: Record<string, unknown> | undefined;
  after: Record<string, unknown> | undefined;
}): ReactNode {
  if (!before && !after) return null;
  const beforeLines = before ? JSON.stringify(before, null, 2).split("\n") : [];
  const afterLines = after ? JSON.stringify(after, null, 2).split("\n") : [];
  return (
    <pre className="m-0 max-h-32 overflow-auto rounded bg-surface-2 p-2 font-mono text-[0.65rem] leading-tight">
      {beforeLines.map((l, i) => (
        <span key={`b-${i}`} className="block bg-err/10 text-err">
          {`- ${l}`}
        </span>
      ))}
      {afterLines.map((l, i) => (
        <span key={`a-${i}`} className="block bg-ok/10 text-ok">
          {`+ ${l}`}
        </span>
      ))}
    </pre>
  );
}
