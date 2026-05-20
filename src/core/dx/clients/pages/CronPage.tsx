/**
 * `/hub/cron` — cron-schedule inventory (CF.JOBS.02). Reads the
 * existing `/hub/scheduled-jobs.json` payload populated by the
 * DiscoveryService walk at OnApplicationBootstrap and renders a
 * read-only table of every `@ScheduledJob`-decorated method.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

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

interface ScheduledJobEntry {
  name: string;
  cron: string;
  source: string;
}

export function CronPage(): ReactNode {
  const query = useQuery({
    queryKey: ["hub", "cron"],
    queryFn: () => fetchJson<{ jobs: ScheduledJobEntry[] }>("/hub/scheduled-jobs.json"),
  });

  return (
    <AdminShell title="Cron" subtitle="Scheduled-job registry" currentNav="cron">
      {query.isPending ? (
        <PageLoading>Loading cron registry…</PageLoading>
      ) : query.isError ? (
        <PageError>Failed to load /hub/scheduled-jobs.json</PageError>
      ) : (query.data?.jobs ?? []).length === 0 ? (
        <PageEmpty>No @ScheduledJob-decorated methods found.</PageEmpty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Registered jobs ({query.data?.jobs.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Cron</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data?.jobs.map((job) => (
                  <TableRow key={job.source}>
                    <TableCell className="font-medium">{job.name}</TableCell>
                    <TableCell className="font-mono text-xs">{job.cron}</TableCell>
                    <TableCell className="font-mono text-xs text-fg-muted">{job.source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </AdminShell>
  );
}
