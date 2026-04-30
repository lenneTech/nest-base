/**
 * `/dev` — verbatim React port of `dashboard-ui.ts` (the legacy
 * server-rendered cockpit). Same hero, same 5-tile stats grid, same
 * services strip, same log preview + features overview, same
 * quick-navigation block.
 *
 * Single fetch: `/dev/dashboard.json` aggregates everything the
 * server cockpit needed (probes + coverage + tests + logs + features
 * + queries + memory + uptime). The status section also re-polls
 * `/dev/status.json` every 4 s so Prisma Studio's "going green"
 * after boot still works without a page refresh.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, formatDuration, levelName, stripProto } from "../lib/api.js";

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
        <div className="admin-empty">Failed to load dashboard data.</div>
      ) : (
        <div className="admin-empty">Loading dashboard…</div>
      )}
    </AdminShell>
  );
}

interface DashboardBodyProps {
  data: DashboardJson;
}

function DashboardBody({ data }: DashboardBodyProps): ReactNode {
  const probesDown = data.probes.filter((p) => p.status === "down").length;
  const overall = computeOverallHealth(data, probesDown);
  const errorLogs = data.logs.filter((r) => r.level >= 50).length;
  const warnLogs = data.logs.filter((r) => r.level === 40).length;

  return (
    <>
      <Hero overall={overall} data={data} />
      <StatsGrid data={data} errorLogs={errorLogs} warnLogs={warnLogs} />
      {data.tunnel?.active && data.tunnel.url ? (
        <TunnelCard url={data.tunnel.url} startedAt={data.tunnel.startedAt} />
      ) : null}
      <ServicesGrid probes={data.probes} />
      <div className="admin-grid admin-grid--2">
        <LogPreview
          records={data.logs}
          capacity={data.logBufferCapacity}
          errorLogs={errorLogs}
          warnLogs={warnLogs}
        />
        <FeatureOverview features={data.features} catalog={data.catalog} />
      </div>
      <QuickLinks />
    </>
  );
}

interface TunnelCardProps {
  url: string;
  startedAt?: string;
}

/**
 * Surfaces the active Cloudflare-Tunnel URL the dev runner discovered.
 * Visible only when `bun run dev --tunnel` is running. Includes a copy
 * button (clipboard write — no secrets in the URL itself, but still
 * convenient when wiring webhooks).
 */
function TunnelCard({ url, startedAt }: TunnelCardProps): ReactNode {
  function copy(): void {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(url);
    }
  }
  const startedLabel = startedAt ? `started ${new Date(startedAt).toLocaleTimeString()}` : "active";
  return (
    <div className="admin-card">
      <h2 className="admin-card__title">
        Cloudflare Tunnel
        <span
          style={{
            fontSize: "0.7rem",
            color: "var(--fg-dim)",
            fontWeight: 500,
            letterSpacing: "0.04em",
          }}
        >
          {startedLabel}
        </span>
        <a
          href="https://github.com/cloudflare/cloudflared"
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--fg-dim)" }}
        >
          About cloudflared →
        </a>
      </h2>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <code
          style={{
            background: "var(--bg-2, #111)",
            padding: "0.4rem 0.6rem",
            borderRadius: "4px",
            fontSize: "0.85rem",
          }}
        >
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          style={{
            padding: "0.4rem 0.8rem",
            fontSize: "0.8rem",
            background: "var(--accent, #c5fb45)",
            color: "#000",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Copy URL
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: "0.4rem 0.8rem",
            fontSize: "0.8rem",
            color: "var(--fg-dim)",
            textDecoration: "none",
            border: "1px solid var(--fg-dim)",
            borderRadius: "4px",
          }}
        >
          Open ↗
        </a>
      </div>
      <p
        style={{
          fontSize: "0.75rem",
          color: "var(--fg-dim)",
          marginTop: "0.6rem",
          marginBottom: 0,
        }}
      >
        Wire this URL into Stripe / GitHub / Slack webhook configs. The URL is public — never run a
        tunnel against a database with real-user data.
      </p>
    </div>
  );
}

interface HeroProps {
  overall: OverallHealth;
  data: DashboardJson;
}

function Hero({ overall, data }: HeroProps): ReactNode {
  const heapPct = Math.round((data.memory.heapUsed / data.memory.heapTotal) * 100);
  const heapMb = (data.memory.heapUsed / (1024 * 1024)).toFixed(1);
  const heapTotalMb = (data.memory.heapTotal / (1024 * 1024)).toFixed(0);
  const stateClass =
    overall.state === "ok" ? "hero--ok" : overall.state === "warn" ? "hero--warn" : "hero--err";
  const stateLabel = overall.state === "ok" ? "OK" : overall.state === "warn" ? "WARN" : "ERR";
  return (
    <div className={`hero ${stateClass}`}>
      <div className="hero__main">
        <span className="hero__state">
          <span className="hero__pulse" />
          {stateLabel}
        </span>
        <h2 className="hero__title">{overall.label}</h2>
        <span className="hero__detail">{overall.detail}</span>
      </div>
      <div className="hero__metric">
        <span className="hero__metric-label">Uptime</span>
        <span className="hero__metric-value">{formatDuration(data.uptimeMs)}</span>
        <span className="hero__metric-sub">since boot</span>
      </div>
      <div className="hero__metric">
        <span className="hero__metric-label">Heap</span>
        <span className="hero__metric-value">{heapMb} MB</span>
        <span className="hero__metric-sub">
          {heapPct}% of {heapTotalMb} MB
        </span>
      </div>
      <div className="hero__metric">
        <span className="hero__metric-label">Node / Bun</span>
        <span className="hero__metric-value">{data.process.bun ?? data.process.node}</span>
        <span className="hero__metric-sub">{data.process.platform}</span>
      </div>
      <div className="hero__metric">
        <span className="hero__metric-label">Base URL</span>
        <span className="hero__metric-value hero__metric-value--mono">
          {stripProto(data.baseUrl)}
        </span>
        <span className="hero__metric-sub">portless / loopback</span>
      </div>
    </div>
  );
}

interface StatsGridProps {
  data: DashboardJson;
  errorLogs: number;
  warnLogs: number;
}

function StatsGrid({ data, errorLogs, warnLogs }: StatsGridProps): ReactNode {
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
    <div className="stat-grid">
      <a className="stat-card" href="/dev/coverage">
        <span className="stat-card__label">Coverage</span>
        <span className="stat-card__value">{covValue}</span>
        {covOk === null ? (
          <span className="stat-card__pill stat-card__pill--neutral">no run yet</span>
        ) : covOk ? (
          <span className="stat-card__pill stat-card__pill--ok">✓ gates pass</span>
        ) : (
          <span className="stat-card__pill stat-card__pill--warn">below threshold</span>
        )}
      </a>
      <a className="stat-card" href="/dev/tests">
        <span className="stat-card__label">Tests</span>
        <span className="stat-card__value">{testsValue}</span>
        {testsOk === null ? (
          <span className="stat-card__pill stat-card__pill--neutral">no run yet</span>
        ) : testsOk ? (
          <span className="stat-card__pill stat-card__pill--ok">✓ all green</span>
        ) : (
          <span className="stat-card__pill stat-card__pill--bad">
            {tests.totals.failed} failing
          </span>
        )}
      </a>
      <a className="stat-card" href="/dev/features">
        <span className="stat-card__label">Features</span>
        <span className="stat-card__value">
          {activeFeatures}
          <span className="stat-card__value-faint"> / {totalFeatures}</span>
        </span>
        <span className="stat-card__pill stat-card__pill--neutral">
          {totalFeatures - activeFeatures} available
        </span>
      </a>
      <a className="stat-card" href="/dev/logs">
        <span className="stat-card__label">Recent Logs</span>
        <span className="stat-card__value">{data.logs.length}</span>
        {errorLogs > 0 ? (
          <span className="stat-card__pill stat-card__pill--bad">
            {errorLogs} error{errorLogs === 1 ? "" : "s"}
          </span>
        ) : warnLogs > 0 ? (
          <span className="stat-card__pill stat-card__pill--warn">
            {warnLogs} warn{warnLogs === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="stat-card__pill stat-card__pill--ok">clean</span>
        )}
      </a>
      <a className="stat-card" href="/dev/queries">
        <span className="stat-card__label">DB Queries</span>
        <span className="stat-card__value">{data.queries.total}</span>
        {data.queries.badCount > 0 ? (
          <span className="stat-card__pill stat-card__pill--bad">
            {data.queries.badCount} critical (&gt; 200 ms)
          </span>
        ) : querySlow > 0 ? (
          <span className="stat-card__pill stat-card__pill--warn">
            {querySlow} slow (&gt; 50 ms)
          </span>
        ) : data.queries.total > 0 ? (
          <span className="stat-card__pill stat-card__pill--ok">all fast</span>
        ) : (
          <span className="stat-card__pill stat-card__pill--neutral">no queries yet</span>
        )}
      </a>
    </div>
  );
}

interface ServicesGridProps {
  probes: ServiceProbe[];
}

function ServicesGrid({ probes }: ServicesGridProps): ReactNode {
  // Re-poll `/dev/status.json` every 4 s to refresh probe state in
  // place — same UX as the server cockpit had via embedded JS.
  const queryClient = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    async function tick(): Promise<void> {
      try {
        const next = await fetchJson<ServiceProbe[]>("/dev/status.json");
        if (cancelled) return;
        // Merge into the dashboard query so the rest of the cockpit
        // stays consistent — and so this re-render is just a state
        // diff, not a fresh fetch of the entire dashboard.
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
    <div className="admin-card">
      <h2 className="admin-card__title">Services</h2>
      <div className="svc-grid">
        {probes.map((p) => {
          const dotCls =
            p.status === "up"
              ? "svc__dot--up"
              : p.status === "down"
                ? "svc__dot--down"
                : "svc__dot--unknown";
          const labelText =
            p.status === "up" ? "online" : p.status === "down" ? "offline" : "unknown";
          const latency = p.latencyMs !== undefined ? `${p.latencyMs} ms` : "";
          const href = p.href ?? p.probeUrl ?? "#";
          const url = p.probeUrl ?? p.href ?? "";
          return (
            <a
              key={p.id}
              className="svc"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              data-service-id={p.id}
              data-status={p.status}
            >
              <div className="svc__head">
                <span className="svc__label">{p.label}</span>
                <span className={`svc__dot ${dotCls}`} title={labelText} />
              </div>
              {url ? <span className="svc__url">{url}</span> : null}
              <div className="svc__meta">
                <span>{labelText}</span>
                <span>{latency}</span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

interface LogPreviewProps {
  records: LogRecord[];
  capacity: number;
  errorLogs: number;
  warnLogs: number;
}

function LogPreview({ records, capacity, errorLogs, warnLogs }: LogPreviewProps): ReactNode {
  const last10 = records.slice(-10).reverse();
  return (
    <div className="admin-card">
      <h2 className="admin-card__title">
        Live logs
        <span
          style={{
            fontSize: "0.7rem",
            color: "var(--fg-dim)",
            fontWeight: 500,
            letterSpacing: "0.04em",
          }}
        >
          last 10 of {records.length}/{capacity}
        </span>
        {errorLogs > 0 ? (
          <span className="stat-card__pill stat-card__pill--bad">
            {errorLogs} error{errorLogs === 1 ? "" : "s"}
          </span>
        ) : null}
        {warnLogs > 0 && errorLogs === 0 ? (
          <span className="stat-card__pill stat-card__pill--warn">
            {warnLogs} warn{warnLogs === 1 ? "" : "s"}
          </span>
        ) : null}
        <a
          href="/dev/logs"
          style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--fg-dim)" }}
        >
          Open full log →
        </a>
      </h2>
      {records.length === 0 ? (
        <div className="admin-empty">No log records yet.</div>
      ) : (
        <table className="admin-table" style={{ fontSize: "0.8rem" }}>
          <tbody>
            {last10.map((r, i) => {
              const lvl = levelName(r.level);
              const time = new Date(r.time).toISOString().slice(11, 19);
              return (
                <tr key={`${r.seq ?? i}`} className={`dash-log dash-log--${lvl}`}>
                  <td className="dash-log__time">{time}</td>
                  <td className="dash-log__level">
                    <span className={`dash-log__chip dash-log__chip--${lvl}`}>{lvl}</span>
                  </td>
                  <td className="dash-log__msg">
                    {r.context ? (
                      <span className="dash-log__ctx">[{String(r.context)}]</span>
                    ) : null}{" "}
                    {String(r.msg ?? "")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface FeatureOverviewProps {
  features: DashboardJson["features"];
  catalog: FeatureMeta[];
}

function FeatureOverview({ features, catalog }: FeatureOverviewProps): ReactNode {
  const total = catalog.length;
  const active = catalog.filter((m) => isFeatureActive(features, m.key)).length;
  return (
    <div className="admin-card">
      <h2 className="admin-card__title">
        Features
        <span
          style={{
            fontSize: "0.7rem",
            color: "var(--fg-dim)",
            fontWeight: 500,
            letterSpacing: "0.04em",
          }}
        >
          {active} / {total} active
        </span>
        <a
          href="/dev/features"
          style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--fg-dim)" }}
        >
          Manage →
        </a>
      </h2>
      <ul className="feat-grid">
        {catalog.map((meta) => {
          const on = isFeatureActive(features, meta.key);
          return (
            <li
              key={meta.key}
              className={`feat-row ${on ? "feat-row--on" : "feat-row--off"}`}
              title={meta.description}
            >
              <span className="feat-row__label">{meta.label}</span>
              <span className="feat-row__chip">{on ? "ON" : "OFF"}</span>
            </li>
          );
        })}
      </ul>
    </div>
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
    <div className="admin-card">
      <h2 className="admin-card__title">Quick navigation</h2>
      <div className="quick-grid">
        {links.map((l) => (
          <a key={l.href} className="quick" href={l.href}>
            <span className="quick__title">{l.label}</span>
            <span className="quick__hint">{l.hint}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
