/**
 * `/hub` — Operator cockpit (not a CI dashboard).
 *
 * Priority: service probes → status groups → queues/logs/queries →
 * optional activity charts → quick links. Coverage and test counts are
 * intentionally omitted — they live on `/hub/coverage` and `/hub/tests`.
 *
 * Data: `GET /hub/dashboard.json`; probes refresh via `/hub/status.json`.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { Link, useOutletContext } from "react-router-dom";

import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Progress } from "../components/ui/progress.js";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "../components/ui/chart.js";
import { PageError, PageLoading, PageEmpty } from "../components/PageState.js";
import type { HubPortalAccess } from "../components/HubPortalGate.js";
import { AdminShell } from "../layout/AdminShell.js";
import {
  buildHubNavFeatureSnapshot,
  isHubQuickLinkVisible,
  isSpaPathWorkstationOnly,
} from "../../hub-nav-planner.js";
import type { Features } from "../../../features/features.js";
import { fetchJson, formatDuration, levelName, stripProto } from "../lib/api.js";
import { hasWorkstationSurfaces } from "../lib/hub-portal-access.js";
import { cn } from "../lib/utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeatureMeta {
  key: string;
  label: string;
  description: string;
  envKey: string;
  category: string;
  exposes: string[];
}

interface ServiceProbe {
  id: string;
  label: string;
  status: "up" | "down" | "unknown";
  latencyMs?: number;
  href?: string;
  probeUrl?: string;
}

interface LogRecord {
  level: number;
  time: number;
  msg?: string;
  context?: string;
  seq?: number;
}

interface TunnelInfo {
  active: boolean;
  url?: string;
  startedAt?: string;
}

type StatusLevel = "ok" | "warn" | "error" | "unknown";

interface StatusItem {
  label: string;
  value: string;
  status: StatusLevel;
}

interface StatusGroup {
  id: "database" | "async" | "external" | "runtime";
  label: string;
  status: StatusLevel;
  items: StatusItem[];
}

interface RequestBucket {
  time: string;
  ok: number;
  err4xx: number;
  err5xx: number;
}

interface SessionBucket {
  hour: string;
  active: number;
  newLogins: number;
}

interface GeoCountry {
  countryCode: string;
  country: string;
  requests: number;
}

interface DashboardJson {
  baseUrl: string;
  uptimeMs: number;
  memory: { heapUsed: number; heapTotal: number; rss: number };
  process: { node: string; bun?: string; platform: string };
  features: Record<string, { enabled?: boolean }>;
  catalog: FeatureMeta[];
  probes: ServiceProbe[];
  logs: LogRecord[];
  logBufferCapacity: number;
  queries: { total: number; slowestMs: number; warnCount: number; badCount: number };
  tunnel?: TunnelInfo;
  statusGroups?: StatusGroup[];
  requestsChart?: { available: boolean; buckets: RequestBucket[] };
  sessionsChart?: { available: boolean; buckets: SessionBucket[] };
  geoTopCountries?: { available: boolean; countries: GeoCountry[] };
}

type OverallHealthState = "ok" | "warn" | "err";
interface OverallHealth {
  state: OverallHealthState;
  label: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFeatureActive(features: DashboardJson["features"], key: string): boolean {
  const section = features[key];
  if (!section || typeof section !== "object") return false;
  return Boolean((section as { enabled?: unknown }).enabled);
}

function computeOverallHealth(input: DashboardJson, probesDown: number): OverallHealth {
  if (probesDown > 0) {
    return {
      state: "err",
      label: "Service unreachable",
      detail: `${probesDown} probe(s) down`,
    };
  }
  const groups = input.statusGroups ?? [];
  const errored = groups.filter((g) => g.status === "error");
  if (errored.length > 0) {
    return {
      state: "err",
      label: "Needs attention",
      detail: errored.map((g) => g.label).join(" · "),
    };
  }
  if (input.queries.badCount > 0) {
    return {
      state: "warn",
      label: "Slow database",
      detail: `${input.queries.badCount} critical queries (>200 ms)`,
    };
  }
  const errorLogs = input.logs.filter((r) => r.level >= 50).length;
  if (errorLogs > 0) {
    return {
      state: "warn",
      label: "Errors in log buffer",
      detail: `${errorLogs} error ${errorLogs === 1 ? "entry" : "entries"}`,
    };
  }
  const warned = groups.filter((g) => g.status === "warn");
  if (warned.length > 0) {
    return {
      state: "warn",
      label: "Degraded",
      detail: warned.map((g) => g.label).join(" · "),
    };
  }
  return { state: "ok", label: "Operational", detail: "No critical signals" };
}

function asyncQueueSummary(groups: StatusGroup[] | undefined): {
  pending: number;
  deadLetters: number;
} {
  const async_ = groups?.find((g) => g.id === "async");
  let pending = 0;
  let deadLetters = 0;
  for (const item of async_?.items ?? []) {
    if (item.label === "Pending jobs" && item.value !== "none") {
      pending = Number.parseInt(item.value, 10) || 0;
    }
    if (item.label === "Dead-Letter-Queue" && item.value !== "empty") {
      const match = item.value.match(/^(\d+)/);
      deadLetters = match ? Number.parseInt(match[1]!, 10) : 0;
    }
  }
  return { pending, deadLetters };
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

export function HubLandingPage(): ReactNode {
  const dashboard = useQuery({
    queryKey: ["hub", "dashboard"],
    queryFn: () => fetchJson<DashboardJson>("/hub/dashboard.json"),
    refetchInterval: 5_000,
  });

  return (
    <AdminShell
      title="Hub"
      subtitle="Live health, queues, and dependencies — for day-to-day operations."
      currentNav="hub"
    >
      {dashboard.data ? (
        <DashboardBody data={dashboard.data} />
      ) : dashboard.isError ? (
        <PageError>Could not load dashboard data.</PageError>
      ) : (
        <PageLoading>Loading dashboard…</PageLoading>
      )}
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// Dashboard body
// ---------------------------------------------------------------------------

function DashboardBody({ data }: { data: DashboardJson }): ReactNode {
  const portalAccess = useOutletContext<HubPortalAccess | undefined>();
  const workstation = hasWorkstationSurfaces(portalAccess);
  const probesDown = data.probes.filter((p) => p.status === "down").length;
  const probesUp = data.probes.filter((p) => p.status === "up").length;
  const overall = computeOverallHealth(data, probesDown);
  const errorLogs = data.logs.filter((r) => r.level >= 50).length;
  const warnLogs = data.logs.filter((r) => r.level === 40).length;
  const queue = asyncQueueSummary(data.statusGroups);
  const showSessions = data.sessionsChart?.available === true;
  const showRequests = data.requestsChart?.available === true;
  const showGeo =
    data.geoTopCountries?.available === true && (data.geoTopCountries.countries?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <Hero overall={overall} data={data} />

      <ServicesGrid probes={data.probes} />

      {data.statusGroups && data.statusGroups.length > 0 ? (
        <StatusGroupBar groups={data.statusGroups} />
      ) : null}

      <OpsMetricsRow
        probesUp={probesUp}
        probesTotal={data.probes.length}
        queue={queue}
        errorLogs={errorLogs}
        warnLogs={warnLogs}
        queries={data.queries}
      />

      {data.tunnel?.active && data.tunnel.url ? (
        <TunnelCard url={data.tunnel.url} startedAt={data.tunnel.startedAt} />
      ) : null}

      {showSessions || showRequests ? (
        <ActivitySection
          requestsChart={showRequests ? data.requestsChart : undefined}
          sessionsChart={showSessions ? data.sessionsChart : undefined}
        />
      ) : null}

      {showGeo ? <GeoSection geoTopCountries={data.geoTopCountries} /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LogPreview
          records={data.logs}
          capacity={data.logBufferCapacity}
          errorLogs={errorLogs}
          warnLogs={warnLogs}
        />
        <FeatureOverview features={data.features} catalog={data.catalog} />
      </div>

      <QuickLinks features={data.features} workstation={workstation} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Operator status groups
// ---------------------------------------------------------------------------

const STATUS_HREF: Record<string, string> = {
  database: "/hub/migrations",
  async: "/hub/jobs",
  external: "/hub/diagnostics",
  runtime: "/hub/diagnostics",
};

function statusBorderClass(s: StatusLevel): string {
  if (s === "ok") return "border-ok/50";
  if (s === "warn") return "border-warn/50";
  if (s === "error") return "border-err/50";
  return "border-line";
}

function statusDotClass(s: StatusLevel): string {
  if (s === "ok") return "bg-ok";
  if (s === "warn") return "bg-warn";
  if (s === "error") return "bg-err";
  return "bg-fg-faint";
}

function statusBadgeVariant(s: StatusLevel): "ok" | "warn" | "err" | "secondary" {
  if (s === "ok") return "ok";
  if (s === "warn") return "warn";
  if (s === "error") return "err";
  return "secondary";
}

function StatusGroupBar({ groups }: { groups: StatusGroup[] }): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {groups.map((g) => (
        <StatusGroupCard key={g.id} group={g} />
      ))}
    </div>
  );
}

function StatusGroupCard({ group }: { group: StatusGroup }): ReactNode {
  const href = STATUS_HREF[group.id] ?? "#";
  return (
    <Link
      to={href}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-surface-1 p-4 transition-colors hover:bg-surface-2",
        statusBorderClass(group.status),
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-fg">{group.label}</span>
        <Badge variant={statusBadgeVariant(group.status)} className="text-[0.65rem] uppercase">
          {group.status === "ok"
            ? "OK"
            : group.status === "warn"
              ? "Warning"
              : group.status === "error"
                ? "Error"
                : "Unknown"}
        </Badge>
      </div>
      <ul className="flex flex-col gap-1.5">
        {group.items.map((item) => (
          <li key={item.label} className="flex items-center justify-between text-xs">
            <span className="text-fg-muted">{item.label}</span>
            <span className="flex items-center gap-1.5 text-fg">
              <span
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(item.status))}
              />
              {item.value}
            </span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Activity charts (only rendered when real data exists)
// ---------------------------------------------------------------------------

function ActivitySection({
  requestsChart,
  sessionsChart,
}: {
  requestsChart?: { available: boolean; buckets: RequestBucket[] };
  sessionsChart?: { available: boolean; buckets: SessionBucket[] };
}): ReactNode {
  const hasRequests = Boolean(requestsChart);
  const hasSessions = Boolean(sessionsChart);
  if (!hasRequests && !hasSessions) return null;

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-6",
        hasRequests && hasSessions ? "md:grid-cols-3" : "md:grid-cols-1",
      )}
    >
      {hasRequests ? (
        <div className={hasSessions ? "md:col-span-2" : ""}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Requests / min — last 24 h</CardTitle>
            </CardHeader>
            <CardContent>
              <RequestsChart buckets={requestsChart?.buckets ?? []} />
            </CardContent>
          </Card>
        </div>
      ) : null}
      {hasSessions ? (
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Sessions — last 24 h</CardTitle>
          </CardHeader>
          <CardContent>
            {(sessionsChart?.buckets ?? []).every((b) => b.active === 0 && b.newLogins === 0) ? (
              <PageEmpty>No session activity in the last 24 hours.</PageEmpty>
            ) : (
              <SessionsChart buckets={sessionsChart?.buckets ?? []} />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function RequestsChart({ buckets }: { buckets: RequestBucket[] }): ReactNode {
  // Show only every 12th label (hourly ticks in a 5-min bucket chart)
  const tickFormatter = (_: unknown, index: number): string => {
    const b = buckets[index];
    return index % 12 === 0 && b ? b.time : "";
  };

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={buckets} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #333)" opacity={0.5} />
        <XAxis
          dataKey="time"
          tick={{ fontSize: 10, fill: "var(--fg-muted, #888)" }}
          tickFormatter={tickFormatter}
          interval={0}
        />
        <YAxis tick={{ fontSize: 10, fill: "var(--fg-muted, #888)" }} />
        <Tooltip
          contentStyle={{
            background: "var(--surface-2, #1a1a1a)",
            border: "1px solid var(--line, #333)",
            fontSize: 11,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area
          type="monotone"
          dataKey="ok"
          name="2xx"
          stackId="1"
          stroke="var(--ok, #4ade80)"
          fill="var(--ok, #4ade80)"
          fillOpacity={0.25}
        />
        <Area
          type="monotone"
          dataKey="err4xx"
          name="4xx"
          stackId="1"
          stroke="var(--warn, #facc15)"
          fill="var(--warn, #facc15)"
          fillOpacity={0.25}
        />
        <Area
          type="monotone"
          dataKey="err5xx"
          name="5xx"
          stackId="1"
          stroke="var(--err, #f87171)"
          fill="var(--err, #f87171)"
          fillOpacity={0.25}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function SessionsChart({ buckets }: { buckets: SessionBucket[] }): ReactNode {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={buckets} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #333)" opacity={0.5} />
        <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "var(--fg-muted, #888)" }} interval={5} />
        <YAxis tick={{ fontSize: 10, fill: "var(--fg-muted, #888)" }} />
        <Tooltip
          contentStyle={{
            background: "var(--surface-2, #1a1a1a)",
            border: "1px solid var(--line, #333)",
            fontSize: 11,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line
          type="monotone"
          dataKey="active"
          name="Active"
          stroke="var(--accent, #c5fb45)"
          dot={false}
          strokeWidth={1.5}
        />
        <Line
          type="monotone"
          dataKey="newLogins"
          name="New sign-ins"
          stroke="var(--ok, #4ade80)"
          dot={false}
          strokeWidth={1.5}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Geographic distribution
// ---------------------------------------------------------------------------

function GeoSection({
  geoTopCountries,
}: {
  geoTopCountries?: { available: boolean; countries: GeoCountry[] };
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Geographic traffic (top countries)</CardTitle>
      </CardHeader>
      <CardContent>
        <GeoTable countries={geoTopCountries?.countries ?? []} />
      </CardContent>
    </Card>
  );
}

function GeoTable({ countries }: { countries: GeoCountry[] }): ReactNode {
  const total = countries.reduce((s, c) => s + c.requests, 0);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left text-[0.65rem] font-semibold uppercase tracking-widest text-fg-faint">
          <th className="pb-2 pr-4">Country</th>
          <th className="pb-2 pr-4">Requests</th>
          <th className="pb-2">Share</th>
        </tr>
      </thead>
      <tbody>
        {countries.map((c) => {
          const pct = total > 0 ? ((c.requests / total) * 100).toFixed(1) : "0.0";
          return (
            <tr key={c.countryCode} className="border-b border-line/40">
              <td className="py-1.5 pr-4">
                <span className="font-mono text-xs text-fg-muted">{c.countryCode}</span> {c.country}
              </td>
              <td className="py-1.5 pr-4 tabular-nums">{c.requests.toLocaleString()}</td>
              <td className="py-1.5 tabular-nums text-fg-muted">{pct} %</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Existing sections (preserved)
// ---------------------------------------------------------------------------

function TunnelCard({ url, startedAt }: { url: string; startedAt?: string }): ReactNode {
  function copy(): void {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(url);
    }
  }
  const startedLabel = startedAt ? `started ${new Date(startedAt).toLocaleTimeString()}` : "active";
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <CardTitle className="flex-1">Cloudflare Tunnel</CardTitle>
        <span className="text-[0.7rem] uppercase tracking-widest text-fg-dim">{startedLabel}</span>
        <a
          href="https://github.com/cloudflare/cloudflared"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-fg-dim hover:text-accent"
        >
          Via cloudflared →
        </a>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-surface-3 px-2 py-1 font-mono text-sm">{url}</code>
          <Button onClick={copy}>Copy URL</Button>
          <Button asChild variant="outline">
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open ↗
            </a>
          </Button>
        </div>
        <p className="text-xs text-fg-muted">
          Enter this URL in Stripe / GitHub / Slack webhook settings. The URL is public — never run
          a tunnel with real user data.
        </p>
      </CardContent>
    </Card>
  );
}

function Hero({ overall, data }: { overall: OverallHealth; data: DashboardJson }): ReactNode {
  const heapPct = Math.round((data.memory.heapUsed / data.memory.heapTotal) * 100);
  const heapMb = (data.memory.heapUsed / (1024 * 1024)).toFixed(1);
  const heapTotalMb = (data.memory.heapTotal / (1024 * 1024)).toFixed(0);
  const stateClass =
    overall.state === "ok"
      ? "border-ok/40 from-ok/10"
      : overall.state === "warn"
        ? "border-warn/40 from-warn/10"
        : "border-err/40 from-err/10";
  const stateLabel = overall.state === "ok" ? "OK" : overall.state === "warn" ? "WARN" : "ERR";
  const dotColor =
    overall.state === "ok" ? "bg-ok" : overall.state === "warn" ? "bg-warn" : "bg-err";
  return (
    <div
      className={cn(
        "relative grid grid-cols-1 gap-6 overflow-hidden rounded-xl border bg-gradient-to-br to-transparent p-6 shadow-md md:grid-cols-[1.5fr_repeat(4,minmax(0,1fr))]",
        stateClass,
      )}
    >
      <div className="flex flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line-strong bg-surface-2 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-fg">
          <span className={cn("h-2 w-2 animate-pulse rounded-full", dotColor)} />
          {stateLabel}
        </span>
        <h2 className="m-0 text-2xl font-semibold tracking-tight">{overall.label}</h2>
        <span className="text-sm text-fg-muted">{overall.detail}</span>
      </div>
      <HeroMetric label="Uptime" value={formatDuration(data.uptimeMs)} hint="since start" />
      <HeroMetric label="Heap" value={`${heapMb} MB`} hint={`${heapPct}% of ${heapTotalMb} MB`} />
      <HeroMetric
        label="Node / Bun"
        value={data.process.bun ?? data.process.node}
        hint={data.process.platform}
      />
      <HeroMetric
        label="Base URL"
        value={stripProto(data.baseUrl)}
        hint="portless / loopback"
        mono
      />
    </div>
  );
}

function HeroMetric({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-fg-faint">
        {label}
      </span>
      <span className={cn("text-xl font-semibold tabular-nums", mono && "font-mono text-base")}>
        {value}
      </span>
      {hint ? <span className="text-xs text-fg-muted">{hint}</span> : null}
    </div>
  );
}

function OpsMetricsRow({
  probesUp,
  probesTotal,
  queue,
  errorLogs,
  warnLogs,
  queries,
}: {
  probesUp: number;
  probesTotal: number;
  queue: { pending: number; deadLetters: number };
  errorLogs: number;
  warnLogs: number;
  queries: DashboardJson["queries"];
}): ReactNode {
  const querySlow = queries.warnCount + queries.badCount;
  const probesDown = probesTotal - probesUp;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Service probes"
        value={
          <>
            {probesUp}
            <span className="text-fg-faint"> / {probesTotal}</span>
          </>
        }
        href="/hub/diagnostics"
      >
        {probesDown > 0 ? (
          <Badge variant="err">{probesDown} offline</Badge>
        ) : (
          <Badge variant="ok">all reachable</Badge>
        )}
      </StatCard>
      <StatCard
        label="Work queues"
        value={queue.deadLetters > 0 ? queue.deadLetters : queue.pending}
        href="/hub/jobs"
      >
        {queue.deadLetters > 0 ? (
          <Badge variant="err">{queue.deadLetters} dead letter(s)</Badge>
        ) : queue.pending > 0 ? (
          <Badge variant="warn">{queue.pending} pending job(s)</Badge>
        ) : (
          <Badge variant="ok">queues idle</Badge>
        )}
      </StatCard>
      <StatCard label="Log buffer" value={errorLogs + warnLogs} href="/hub/logs">
        {errorLogs > 0 ? (
          <Badge variant="err">{errorLogs} error</Badge>
        ) : warnLogs > 0 ? (
          <Badge variant="warn">{warnLogs} warn</Badge>
        ) : (
          <Badge variant="ok">no errors</Badge>
        )}
      </StatCard>
      <StatCard label="DB queries (buffer)" value={queries.total} href="/hub/queries">
        {queries.badCount > 0 ? (
          <Badge variant="err">{queries.badCount} critical (&gt;200 ms)</Badge>
        ) : querySlow > 0 ? (
          <Badge variant="warn">{querySlow} slow (&gt;50 ms)</Badge>
        ) : queries.total > 0 ? (
          <Badge variant="ok">within budget</Badge>
        ) : (
          <Badge variant="secondary">no samples yet</Badge>
        )}
      </StatCard>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  children,
}: {
  label: string;
  value: ReactNode;
  href: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <Link
      to={href}
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface-1 p-4 transition-colors hover:border-line-accent hover:bg-surface-2"
    >
      <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-fg-faint">
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {children}
    </Link>
  );
}

function ServicesGrid({ probes }: { probes: ServiceProbe[] }): ReactNode {
  // Re-poll `/hub/status.json` every 4 s to refresh probe state in
  // place — same UX as the server cockpit had via embedded JS.
  const queryClient = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    async function tick(): Promise<void> {
      try {
        const next = await fetchJson<ServiceProbe[]>("/hub/status.json");
        if (cancelled) return;
        queryClient.setQueryData<DashboardJson | undefined>(["hub", "dashboard"], (prev) =>
          prev ? { ...prev, probes: next } : prev,
        );
      } catch {
        /* swallow — next tick will retry */
      }
    }
    const interval = setInterval(tick, 4000);
    const initial = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(initial);
    };
  }, [queryClient]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Services</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {probes.map((p) => {
            const dot =
              p.status === "up"
                ? "bg-ok shadow-[0_0_8px_var(--ok)]"
                : p.status === "down"
                  ? "bg-err shadow-[0_0_8px_var(--err)]"
                  : "bg-fg-faint";
            const labelText =
              p.status === "up" ? "online" : p.status === "down" ? "offline" : "unknown";
            const latency = p.latencyMs !== undefined ? `${p.latencyMs} ms` : "";
            const href = p.href ?? p.probeUrl ?? "#";
            const url = p.probeUrl ?? p.href ?? "";
            return (
              <a
                key={p.id}
                className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3 transition-colors hover:border-line-accent"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                data-service-id={p.id}
                data-status={p.status}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-fg">{p.label}</span>
                  <span className={cn("h-2 w-2 rounded-full", dot)} title={labelText} />
                </div>
                {url ? (
                  <span className="truncate font-mono text-[0.7rem] text-fg-muted">{url}</span>
                ) : null}
                <div className="flex items-center justify-between text-[0.7rem] text-fg-dim">
                  <span>{labelText}</span>
                  <span>{latency}</span>
                </div>
              </a>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function LogPreview({
  records,
  capacity,
  errorLogs,
  warnLogs,
}: {
  records: LogRecord[];
  capacity: number;
  errorLogs: number;
  warnLogs: number;
}): ReactNode {
  const last10 = records.slice(-10).reverse();
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <CardTitle className="flex-1">Live-Logs</CardTitle>
        <span className="text-[0.7rem] uppercase tracking-widest text-fg-dim">
          last 10 of {records.length}/{capacity}
        </span>
        {errorLogs > 0 ? <Badge variant="err">{errorLogs} Error</Badge> : null}
        {warnLogs > 0 && errorLogs === 0 ? (
          <Badge variant="warn">
            {warnLogs} Warning{warnLogs === 1 ? "" : "en"}
          </Badge>
        ) : null}
        <Link to="/hub/logs" className="text-xs text-fg-dim hover:text-accent">
          All logs →
        </Link>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <p className="text-sm text-fg-muted">No log entries yet.</p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {last10.map((r, i) => {
                const lvl = levelName(r.level);
                const time = new Date(r.time).toISOString().slice(11, 19);
                const tone =
                  lvl === "fatal" || lvl === "error"
                    ? "err"
                    : lvl === "warn"
                      ? "warn"
                      : lvl === "info"
                        ? "info"
                        : "secondary";
                return (
                  <tr key={`${r.seq ?? i}`}>
                    <td className="py-1 pr-2 font-mono text-[0.7rem] text-fg-muted">{time}</td>
                    <td className="py-1 pr-2">
                      <Badge variant={tone}>{lvl}</Badge>
                    </td>
                    <td className="py-1 font-mono">
                      {r.context ? (
                        <span className="text-accent">[{String(r.context)}]</span>
                      ) : null}{" "}
                      {String(r.msg ?? "")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function FeatureOverview({
  features,
  catalog,
}: {
  features: DashboardJson["features"];
  catalog: FeatureMeta[];
}): ReactNode {
  const total = catalog.length;
  const active = catalog.filter((m) => isFeatureActive(features, m.key)).length;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <CardTitle className="flex-1">Features</CardTitle>
        <span className="text-[0.7rem] uppercase tracking-widest text-fg-dim">
          {active} / {total} active
        </span>
        <Link to="/hub/features" className="text-xs text-fg-dim hover:text-accent">
          Manage →
        </Link>
      </CardHeader>
      <CardContent>
        <Progress className="mb-3" value={total === 0 ? 0 : (active / total) * 100} />
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {catalog.map((meta) => {
            const on = isFeatureActive(features, meta.key);
            return (
              <li
                key={meta.key}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md border border-line/40 px-2 py-1 text-xs",
                  on ? "bg-accent-soft/40" : "bg-surface-2/50",
                )}
                title={meta.description}
              >
                <span className="truncate text-fg-muted">{meta.label}</span>
                <Badge variant={on ? "ok" : "secondary"} className="text-[0.6rem]">
                  {on ? "ON" : "OFF"}
                </Badge>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function QuickLinks({
  features,
  workstation,
}: {
  features: DashboardJson["features"];
  workstation: boolean;
}): ReactNode {
  const navSnapshot = buildHubNavFeatureSnapshot(features as Features);
  const links = [
    { href: "/api/docs", label: "API Reference", hint: "Interactive OpenAPI 3.1 reference" },
    {
      href: "/openapi",
      label: "OpenAPI Spec",
      hint: "JSON viewer + raw download",
    },
    {
      href: "/admin/permissions/test",
      label: "Permission Tester",
      hint: "Resolve CASL permission per user",
    },
    { href: "/admin/webhooks", label: "Webhook Inspector", hint: "Latest deliveries + replay" },
    { href: "/admin/realtime", label: "Realtime Inspector", hint: "Active sockets + events" },
    { href: "/admin/audit", label: "Audit Browser", hint: "Filter audit log entries" },
    { href: "/admin/search", label: "Search Tester", hint: "FTS query + tsquery debug" },
    {
      href: "/admin/tenants",
      label: "Tenant management",
      hint: "Create tenants, archive them, and manage members",
    },
    { href: "/errors", label: "Error catalog", hint: "All CORE_* error codes" },
    {
      href: "/hub/postgrest-parse?status=eq.draft&age=gte.18",
      label: "PostgREST Parser",
      hint: "Try the WHERE clause parser",
    },
    { href: "/hub/diagnostics", label: "Diagnostics", hint: "Memory, versions, runtime" },
  ].filter(
    (link) =>
      isHubQuickLinkVisible(link.href, navSnapshot) &&
      // Workstation-tier targets vanish with the tier (deployed server).
      (workstation || !isSpaPathWorkstationOnly(link.href.split("?")[0] ?? link.href)),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick links</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {links.map((l) => (
            <a
              key={l.href}
              className="flex flex-col gap-1 rounded-lg border border-line bg-surface-2 p-3 transition-colors hover:border-line-accent"
              href={l.href}
            >
              <span className="font-medium text-fg">{l.label}</span>
              <span className="text-[0.7rem] text-fg-muted">{l.hint}</span>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
