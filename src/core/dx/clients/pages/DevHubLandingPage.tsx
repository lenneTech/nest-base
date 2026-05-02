/**
 * `/dev` — Dev Hub landing page. Hero block + 5-tile stats grid +
 * services strip + log preview + features overview + quick-links.
 *
 * Single fetch: `/dev/dashboard.json` aggregates everything the cockpit
 * needs (probes + coverage + tests + logs + features + queries +
 * memory + uptime). The status section also re-polls
 * `/dev/status.json` every 4 s for fast probe updates.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Progress } from "../components/ui/progress.js";
import { PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, formatDuration, levelName, stripProto } from "../lib/api.js";
import { cn } from "../lib/utils.js";

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

interface CoverageReport {
  available: boolean;
  total?: { lines: { pct: number } };
  thresholds: { core: number; modules: number };
  gate: { coreOk: boolean; modulesOk: boolean; overallOk: boolean };
}

interface TestSummary {
  available: boolean;
  totals: {
    tests: number;
    passed: number;
    failed: number;
    durationMs: number;
    success: boolean;
  };
}

interface TunnelInfo {
  active: boolean;
  url?: string;
  startedAt?: string;
}

interface DashboardJson {
  baseUrl: string;
  uptimeMs: number;
  memory: { heapUsed: number; heapTotal: number; rss: number };
  process: { node: string; bun?: string; platform: string };
  features: Record<string, { enabled?: boolean }>;
  catalog: FeatureMeta[];
  probes: ServiceProbe[];
  coverage: CoverageReport;
  tests: TestSummary;
  logs: LogRecord[];
  logBufferCapacity: number;
  queries: { total: number; slowestMs: number; warnCount: number; badCount: number };
  tunnel?: TunnelInfo;
}

type OverallHealthState = "ok" | "warn" | "err";
interface OverallHealth {
  state: OverallHealthState;
  label: string;
  detail: string;
}

function isFeatureActive(features: DashboardJson["features"], key: string): boolean {
  const section = features[key];
  if (!section || typeof section !== "object") return false;
  return Boolean((section as { enabled?: unknown }).enabled);
}

function computeOverallHealth(input: DashboardJson, probesDown: number): OverallHealth {
  if (probesDown > 0) {
    return {
      state: "err",
      label: "Issues detected",
      detail: `${probesDown} service(s) offline`,
    };
  }
  if (input.coverage.available && !input.coverage.gate.overallOk) {
    const t = input.coverage.thresholds;
    return {
      state: "warn",
      label: "Coverage below threshold",
      detail: `core ≥ ${t.core}% / modules ≥ ${t.modules}%`,
    };
  }
  if (input.tests.available && !input.tests.totals.success) {
    return {
      state: "err",
      label: "Tests failing",
      detail: `${input.tests.totals.failed} failed`,
    };
  }
  return { state: "ok", label: "All systems operational", detail: "Ready to ship" };
}

export function DevHubLandingPage(): ReactNode {
  const dashboard = useQuery({
    queryKey: ["dev", "dashboard"],
    queryFn: () => fetchJson<DashboardJson>("/dev/dashboard.json"),
    refetchInterval: 5_000,
  });

  return (
    <AdminShell
      title="Dev Hub"
      subtitle="Real-time cockpit for everything this server runs."
      currentNav="dev-hub"
    >
      {dashboard.data ? (
        <DashboardBody data={dashboard.data} />
      ) : dashboard.isError ? (
        <PageError>Failed to load dashboard data.</PageError>
      ) : (
        <PageLoading>Loading dashboard…</PageLoading>
      )}
    </AdminShell>
  );
}

function DashboardBody({ data }: { data: DashboardJson }): ReactNode {
  const probesDown = data.probes.filter((p) => p.status === "down").length;
  const overall = computeOverallHealth(data, probesDown);
  const errorLogs = data.logs.filter((r) => r.level >= 50).length;
  const warnLogs = data.logs.filter((r) => r.level === 40).length;

  return (
    <div className="flex flex-col gap-6">
      <Hero overall={overall} data={data} />
      <StatsGrid data={data} errorLogs={errorLogs} warnLogs={warnLogs} />
      {data.tunnel?.active && data.tunnel.url ? (
        <TunnelCard url={data.tunnel.url} startedAt={data.tunnel.startedAt} />
      ) : null}
      <ServicesGrid probes={data.probes} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LogPreview
          records={data.logs}
          capacity={data.logBufferCapacity}
          errorLogs={errorLogs}
          warnLogs={warnLogs}
        />
        <FeatureOverview features={data.features} catalog={data.catalog} />
      </div>
      <QuickLinks />
    </div>
  );
}

function TunnelCard({ url, startedAt }: { url: string; startedAt?: string }): ReactNode {
  function copy(): void {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(url);
    }
  }
  const startedLabel = startedAt
    ? `started ${new Date(startedAt).toLocaleTimeString()}`
    : "active";
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
          About cloudflared →
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
          Wire this URL into Stripe / GitHub / Slack webhook configs. The URL is public — never run
          a tunnel against a database with real-user data.
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
      <HeroMetric label="Uptime" value={formatDuration(data.uptimeMs)} hint="since boot" />
      <HeroMetric
        label="Heap"
        value={`${heapMb} MB`}
        hint={`${heapPct}% of ${heapTotalMb} MB`}
      />
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

function StatsGrid({
  data,
  errorLogs,
  warnLogs,
}: {
  data: DashboardJson;
  errorLogs: number;
  warnLogs: number;
}): ReactNode {
  const cov = data.coverage;
  const covValue = cov.available ? `${cov.total?.lines.pct.toFixed(1) ?? "—"}%` : "—";
  const covOk = cov.available ? cov.gate.overallOk : null;

  const tests = data.tests;
  const testsValue = tests.available ? `${tests.totals.passed}/${tests.totals.tests}` : "—";
  const testsOk = tests.available ? tests.totals.success : null;

  const totalFeatures = data.catalog.length;
  const activeFeatures = data.catalog.filter((m) => isFeatureActive(data.features, m.key)).length;

  const querySlow = data.queries.warnCount + data.queries.badCount;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard label="Coverage" value={covValue} href="/dev/coverage">
        {covOk === null ? (
          <Badge variant="secondary">no run yet</Badge>
        ) : covOk ? (
          <Badge variant="ok">✓ gates pass</Badge>
        ) : (
          <Badge variant="warn">below threshold</Badge>
        )}
      </StatCard>
      <StatCard label="Tests" value={testsValue} href="/dev/tests">
        {testsOk === null ? (
          <Badge variant="secondary">no run yet</Badge>
        ) : testsOk ? (
          <Badge variant="ok">✓ all green</Badge>
        ) : (
          <Badge variant="err">{tests.totals.failed} failing</Badge>
        )}
      </StatCard>
      <StatCard
        label="Features"
        value={
          <>
            {activeFeatures}
            <span className="text-fg-faint"> / {totalFeatures}</span>
          </>
        }
        href="/dev/features"
      >
        <Badge variant="secondary">{totalFeatures - activeFeatures} available</Badge>
      </StatCard>
      <StatCard label="Recent Logs" value={data.logs.length} href="/dev/logs">
        {errorLogs > 0 ? (
          <Badge variant="err">
            {errorLogs} error{errorLogs === 1 ? "" : "s"}
          </Badge>
        ) : warnLogs > 0 ? (
          <Badge variant="warn">
            {warnLogs} warn{warnLogs === 1 ? "" : "s"}
          </Badge>
        ) : (
          <Badge variant="ok">clean</Badge>
        )}
      </StatCard>
      <StatCard label="DB Queries" value={data.queries.total} href="/dev/queries">
        {data.queries.badCount > 0 ? (
          <Badge variant="err">{data.queries.badCount} critical (&gt; 200 ms)</Badge>
        ) : querySlow > 0 ? (
          <Badge variant="warn">{querySlow} slow (&gt; 50 ms)</Badge>
        ) : data.queries.total > 0 ? (
          <Badge variant="ok">all fast</Badge>
        ) : (
          <Badge variant="secondary">no queries yet</Badge>
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
  // Re-poll `/dev/status.json` every 4 s to refresh probe state in
  // place — same UX as the server cockpit had via embedded JS.
  const queryClient = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    async function tick(): Promise<void> {
      try {
        const next = await fetchJson<ServiceProbe[]>("/dev/status.json");
        if (cancelled) return;
        queryClient.setQueryData<DashboardJson | undefined>(["dev", "dashboard"], (prev) =>
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
        <CardTitle className="flex-1">Live logs</CardTitle>
        <span className="text-[0.7rem] uppercase tracking-widest text-fg-dim">
          last 10 of {records.length}/{capacity}
        </span>
        {errorLogs > 0 ? (
          <Badge variant="err">
            {errorLogs} error{errorLogs === 1 ? "" : "s"}
          </Badge>
        ) : null}
        {warnLogs > 0 && errorLogs === 0 ? (
          <Badge variant="warn">
            {warnLogs} warn{warnLogs === 1 ? "" : "s"}
          </Badge>
        ) : null}
        <Link to="/dev/logs" className="text-xs text-fg-dim hover:text-accent">
          Open full log →
        </Link>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <p className="text-sm text-fg-muted">No log records yet.</p>
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
                      {r.context ? <span className="text-accent">[{String(r.context)}]</span> : null}{" "}
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
        <Link to="/dev/features" className="text-xs text-fg-dim hover:text-accent">
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

function QuickLinks(): ReactNode {
  const links = [
    { href: "/api/docs", label: "Scalar API Reference", hint: "Interactive OpenAPI 3.1 reference" },
    {
      href: "/api/openapi",
      label: "OpenAPI Spec",
      hint: "Pretty-printed JSON viewer + raw download",
    },
    {
      href: "/admin/permissions/test",
      label: "Permission Tester",
      hint: "Resolve CASL ability per user",
    },
    { href: "/admin/webhooks", label: "Webhook Inspector", hint: "Recent deliveries + replay" },
    { href: "/admin/realtime", label: "Realtime Inspector", hint: "Active sockets + events" },
    { href: "/admin/audit", label: "Audit Browser", hint: "Filter audit-log entries" },
    { href: "/admin/search", label: "Search Tester", hint: "FTS query + tsquery debug" },
    { href: "/errors", label: "Error Catalog", hint: "All CORE_* error codes" },
    {
      href: "/dev/postgrest-parse?status=eq.draft&age=gte.18",
      label: "PostgREST Parser",
      hint: "Try the WHERE-clause parser",
    },
    { href: "/dev/diagnostics", label: "Diagnostics", hint: "Memory, versions, runtime" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick navigation</CardTitle>
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
