/**
 * `/dev` — Dev Hub landing page. Hero block + operator status groups +
 * activity charts + geo table + 5-tile stats grid + services strip +
 * log preview + features overview + quick-links.
 *
 * Single fetch: `/api/hub/dashboard.json` aggregates everything the
 * cockpit needs. The status section also re-polls
 * `/dev/status.json` every 4 s for fast probe updates.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";

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
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, formatDuration, levelName, stripProto } from "../lib/api.js";
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
  coverage: CoverageReport;
  tests: TestSummary;
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

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

export function DevHubLandingPage(): ReactNode {
  const dashboard = useQuery({
    queryKey: ["dev", "dashboard"],
    queryFn: () => fetchJson<DashboardJson>("/api/hub/dashboard.json"),
    refetchInterval: 5_000,
  });

  return (
    <AdminShell
      title="Dev Hub"
      subtitle="Echtzeit-Cockpit für alle Systeme dieses Servers."
      currentNav="dev-hub"
    >
      {dashboard.data ? (
        <DashboardBody data={dashboard.data} />
      ) : dashboard.isError ? (
        <PageError>Dashboard-Daten konnten nicht geladen werden.</PageError>
      ) : (
        <PageLoading>Dashboard wird geladen…</PageLoading>
      )}
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// Dashboard body
// ---------------------------------------------------------------------------

function DashboardBody({ data }: { data: DashboardJson }): ReactNode {
  const probesDown = data.probes.filter((p) => p.status === "down").length;
  const overall = computeOverallHealth(data, probesDown);
  const errorLogs = data.logs.filter((r) => r.level >= 50).length;
  const warnLogs = data.logs.filter((r) => r.level === 40).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Hero — overall health + runtime metrics */}
      <Hero overall={overall} data={data} />

      {/* Operator status groups — four coloured status cards */}
      {data.statusGroups && data.statusGroups.length > 0 ? (
        <StatusGroupBar groups={data.statusGroups} />
      ) : null}

      {/* Charts row — requests, error rate, sessions */}
      <ChartsRow
        requestsChart={data.requestsChart}
        sessionsChart={data.sessionsChart}
      />

      {/* Geographic request distribution */}
      <GeoSection geoTopCountries={data.geoTopCountries} />

      {/* Stats grid */}
      <StatsGrid data={data} errorLogs={errorLogs} warnLogs={warnLogs} />

      {/* Tunnel alert (when active) */}
      {data.tunnel?.active && data.tunnel.url ? (
        <TunnelCard url={data.tunnel.url} startedAt={data.tunnel.startedAt} />
      ) : null}

      {/* Services */}
      <ServicesGrid probes={data.probes} />

      {/* Logs + Features */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LogPreview
          records={data.logs}
          capacity={data.logBufferCapacity}
          errorLogs={errorLogs}
          warnLogs={warnLogs}
        />
        <FeatureOverview features={data.features} catalog={data.catalog} />
      </div>

      {/* Quick links */}
      <QuickLinks />
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
              ? "Warnung"
              : group.status === "error"
                ? "Fehler"
                : "Unbekannt"}
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
// Charts row
// ---------------------------------------------------------------------------

function ChartsRow({
  requestsChart,
  sessionsChart,
}: {
  requestsChart?: { available: boolean; buckets: RequestBucket[] };
  sessionsChart?: { available: boolean; buckets: SessionBucket[] };
}): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {/* Requests / Fehlerrate chart (spans 2 cols) */}
      <div className="md:col-span-2">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Anfragen / min — Letzte 24 Stunden</CardTitle>
          </CardHeader>
          <CardContent>
            {requestsChart?.available === false ? (
              <PageEmpty>Kein Datenmaterial — Anfrage-Log noch nicht befüllt.</PageEmpty>
            ) : (
              <RequestsChart buckets={requestsChart?.buckets ?? []} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sessions chart */}
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Sitzungen</CardTitle>
        </CardHeader>
        <CardContent>
          {sessionsChart?.available === false ? (
            <PageEmpty>Kein Datenmaterial — Sitzungs-Log noch nicht befüllt.</PageEmpty>
          ) : (
            <SessionsChart buckets={sessionsChart?.buckets ?? []} />
          )}
        </CardContent>
      </Card>
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
        <XAxis
          dataKey="hour"
          tick={{ fontSize: 10, fill: "var(--fg-muted, #888)" }}
          interval={5}
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
        <Line
          type="monotone"
          dataKey="active"
          name="Aktiv"
          stroke="var(--accent, #c5fb45)"
          dot={false}
          strokeWidth={1.5}
        />
        <Line
          type="monotone"
          dataKey="newLogins"
          name="Neue Logins"
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
        <CardTitle>Geografische Anfragenverteilung</CardTitle>
      </CardHeader>
      <CardContent>
        {geoTopCountries?.available === false ? (
          <PageEmpty>
            Kein Datenmaterial — GeoIP-Datenbank installieren und Anfrage-Log aktivieren.
          </PageEmpty>
        ) : (geoTopCountries?.countries ?? []).length === 0 ? (
          <PageEmpty>Noch keine geografischen Daten.</PageEmpty>
        ) : (
          <GeoTable countries={geoTopCountries?.countries ?? []} />
        )}
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
          <th className="pb-2 pr-4">Land</th>
          <th className="pb-2 pr-4">Anfragen</th>
          <th className="pb-2">Anteil</th>
        </tr>
      </thead>
      <tbody>
        {countries.map((c) => {
          const pct = total > 0 ? ((c.requests / total) * 100).toFixed(1) : "0.0";
          return (
            <tr key={c.countryCode} className="border-b border-line/40">
              <td className="py-1.5 pr-4">
                <span className="font-mono text-xs text-fg-muted">{c.countryCode}</span>{" "}
                {c.country}
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
  const startedLabel = startedAt ? `gestartet ${new Date(startedAt).toLocaleTimeString()}` : "aktiv";
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
          Über cloudflared →
        </a>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-surface-3 px-2 py-1 font-mono text-sm">{url}</code>
          <Button onClick={copy}>URL kopieren</Button>
          <Button asChild variant="outline">
            <a href={url} target="_blank" rel="noopener noreferrer">
              Öffnen ↗
            </a>
          </Button>
        </div>
        <p className="text-xs text-fg-muted">
          Diese URL in Stripe / GitHub / Slack Webhook-Konfigurationen eintragen. Die URL ist öffentlich — nie einen Tunnel mit echten Nutzerdaten betreiben.
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
      <HeroMetric label="Uptime" value={formatDuration(data.uptimeMs)} hint="seit Start" />
      <HeroMetric label="Heap" value={`${heapMb} MB`} hint={`${heapPct}% von ${heapTotalMb} MB`} />
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
      <StatCard label="Coverage" value={covValue} href="/hub/coverage">
        {covOk === null ? (
          <Badge variant="secondary">kein Run</Badge>
        ) : covOk ? (
          <Badge variant="ok">✓ Gates OK</Badge>
        ) : (
          <Badge variant="warn">unter Schwellwert</Badge>
        )}
      </StatCard>
      <StatCard label="Tests" value={testsValue} href="/hub/tests">
        {testsOk === null ? (
          <Badge variant="secondary">kein Run</Badge>
        ) : testsOk ? (
          <Badge variant="ok">✓ alle grün</Badge>
        ) : (
          <Badge variant="err">{tests.totals.failed} fehlgeschlagen</Badge>
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
        href="/hub/features"
      >
        <Badge variant="secondary">{totalFeatures - activeFeatures} verfügbar</Badge>
      </StatCard>
      <StatCard label="Aktuelle Logs" value={data.logs.length} href="/hub/logs">
        {errorLogs > 0 ? (
          <Badge variant="err">
            {errorLogs} Fehler
          </Badge>
        ) : warnLogs > 0 ? (
          <Badge variant="warn">
            {warnLogs} Warnung{warnLogs === 1 ? "" : "en"}
          </Badge>
        ) : (
          <Badge variant="ok">sauber</Badge>
        )}
      </StatCard>
      <StatCard label="DB-Abfragen" value={data.queries.total} href="/hub/queries">
        {data.queries.badCount > 0 ? (
          <Badge variant="err">{data.queries.badCount} kritisch (&gt; 200 ms)</Badge>
        ) : querySlow > 0 ? (
          <Badge variant="warn">{querySlow} langsam (&gt; 50 ms)</Badge>
        ) : data.queries.total > 0 ? (
          <Badge variant="ok">alle schnell</Badge>
        ) : (
          <Badge variant="secondary">noch keine Abfragen</Badge>
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
        const next = await fetchJson<ServiceProbe[]>("/api/hub/status.json");
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
              p.status === "up" ? "online" : p.status === "down" ? "offline" : "unbekannt";
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
          letzte 10 von {records.length}/{capacity}
        </span>
        {errorLogs > 0 ? (
          <Badge variant="err">
            {errorLogs} Fehler
          </Badge>
        ) : null}
        {warnLogs > 0 && errorLogs === 0 ? (
          <Badge variant="warn">
            {warnLogs} Warnung{warnLogs === 1 ? "" : "en"}
          </Badge>
        ) : null}
        <Link to="/hub/logs" className="text-xs text-fg-dim hover:text-accent">
          Alle Logs →
        </Link>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <p className="text-sm text-fg-muted">Noch keine Log-Einträge.</p>
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
          {active} / {total} aktiv
        </span>
        <Link to="/hub/features" className="text-xs text-fg-dim hover:text-accent">
          Verwalten →
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
                  {on ? "AN" : "AUS"}
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
    { href: "/api/docs", label: "Scalar API Reference", hint: "Interaktive OpenAPI 3.1 Referenz" },
    {
      href: "/api/openapi",
      label: "OpenAPI-Spec",
      hint: "Hübscher JSON-Viewer + Rohdaten-Download",
    },
    {
      href: "/admin/permissions/test",
      label: "Permission Tester",
      hint: "CASL-Ability pro Nutzer auflösen",
    },
    { href: "/admin/webhooks", label: "Webhook Inspector", hint: "Letzte Zustellungen + Replay" },
    { href: "/admin/realtime", label: "Realtime Inspector", hint: "Aktive Sockets + Events" },
    { href: "/admin/audit", label: "Audit Browser", hint: "Audit-Log-Einträge filtern" },
    { href: "/admin/search", label: "Search Tester", hint: "FTS-Abfrage + tsquery Debug" },
    { href: "/errors", label: "Fehlerkatalog", hint: "Alle CORE_*-Fehlercodes" },
    {
      href: "/hub/postgrest-parse?status=eq.draft&age=gte.18",
      label: "PostgREST Parser",
      hint: "WHERE-Klausel-Parser ausprobieren",
    },
    { href: "/hub/diagnostics", label: "Diagnose", hint: "Speicher, Versionen, Runtime" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Schnellnavigation</CardTitle>
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
