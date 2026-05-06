/**
 * `/admin/permissions/test` — resolve effective CASL ability for a
 * user / tenant pair. URL-driven so back-button replays prior lookups.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
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

interface ResourceReport {
  actions: string[];
  isSuperset: boolean;
}

interface PermissionReport {
  userId: string;
  tenantId: string;
  byResource: Record<string, ResourceReport>;
}

interface PermissionTestResponse {
  report: PermissionReport | null;
  submitted: { userId: string; tenantId: string };
}

export function PermissionTesterPage(): ReactNode {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const userId = params.get("userId") ?? "";
  const tenantId = params.get("tenantId") ?? "";
  const hasInputs = userId.length > 0 && tenantId.length > 0;

  const url = `/api/admin/permissions/test.json?userId=${encodeURIComponent(userId)}&tenantId=${encodeURIComponent(tenantId)}`;

  const data = useQuery({
    queryKey: ["admin", "permissions", "test", userId, tenantId],
    queryFn: () => fetchJson<PermissionTestResponse>(url),
    enabled: hasInputs,
  });

  return (
    <AdminShell
      title="Permission Tester"
      subtitle="Resolve effective CASL ability for a user/tenant pair."
      currentNav="permissions"
    >
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Lookup</CardTitle>
          </CardHeader>
          <CardContent>
            {/*
              GET form — submit updates the URL which triggers the
              useLocation -> useQuery chain above.
            */}
            <form
              method="get"
              action="/api/admin/permissions/test"
              className="flex flex-wrap items-end gap-3"
            >
              <div className="flex flex-1 min-w-48 flex-col gap-1.5">
                <Label htmlFor="userId">User ID</Label>
                <Input id="userId" name="userId" defaultValue={userId} placeholder="user uuid" />
              </div>
              <div className="flex flex-1 min-w-48 flex-col gap-1.5">
                <Label htmlFor="tenantId">Tenant ID</Label>
                <Input
                  id="tenantId"
                  name="tenantId"
                  defaultValue={tenantId}
                  placeholder="tenant uuid"
                />
              </div>
              <Button type="submit">Test</Button>
            </form>
          </CardContent>
        </Card>
        {hasInputs ? <ReportSection data={data.data} isError={data.isError} /> : null}
      </div>
    </AdminShell>
  );
}

interface ReportSectionProps {
  data: PermissionTestResponse | undefined;
  isError: boolean;
}

function ReportSection({ data, isError }: ReportSectionProps): ReactNode {
  if (isError) {
    return <PageError>Failed to resolve permissions.</PageError>;
  }
  if (!data?.report) {
    return <PageLoading>Resolving permissions…</PageLoading>;
  }
  const report = data.report;
  const resources = Object.keys(report.byResource).sort();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Effective abilities</CardTitle>
        <p className="text-xs text-fg-muted">
          User <strong className="text-fg">{report.userId}</strong> in tenant{" "}
          <strong className="text-fg">{report.tenantId}</strong>
        </p>
      </CardHeader>
      <CardContent>
        {resources.length === 0 ? (
          <PageEmpty>No permissions found for this user.</PageEmpty>
        ) : (
          <Table data-permission-report="true">
            <TableHeader>
              <TableRow>
                <TableHead>Resource</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resources.map((resource) => {
                const entry = report.byResource[resource]!;
                return (
                  <TableRow key={resource} data-superset={entry.isSuperset ? "true" : undefined}>
                    <TableCell className="font-mono text-xs">
                      {resource}
                      {entry.isSuperset ? (
                        <Badge variant="info" className="ml-2">
                          superset
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.actions.join(", ")}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
