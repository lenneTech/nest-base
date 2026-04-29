import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { Controller, Get, Header, NotFoundException, Query } from "@nestjs/common";

import { type Features, loadFeatures } from "../features/features.js";
import { type PrismaWhere, parsePostgrestQuery } from "../permissions/postgrest-query.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { APP_NAME, APP_VERSION } from "../app/app.metadata.js";
import { renderAdminLayout } from "./admin-layout.js";
import { buildCoverageReport, type RawCoverageSummary } from "./coverage-report.js";
import { renderCoveragePage } from "./coverage-ui.js";
import { resolveEffectiveBaseUrl } from "./effective-base-url.js";
import { buildDiagnosticsReport, type DiagnosticsReport } from "./diagnostics.js";
import { type DevHubLink, planDevHub } from "./dev-hub.js";
import { getLogBuffer } from "./log-buffer.js";
import { renderLogViewerPage } from "./log-viewer-ui.js";
import { buildTestSummary, type RawTestSummary } from "./test-summary.js";
import { renderTestSummaryPage } from "./test-summary-ui.js";
import { planServiceCandidates, probeServices, type ServiceProbeResult } from "./service-status.js";

/**
 * `/dev/*` — Developer-only landing + JSON inspection routes.
 *
 * - `GET /dev`             — HTML landing page (categorised tool links)
 * - `GET /dev/features`    — active Features object as JSON
 * - `GET /dev/diagnostics` — runtime + memory + features report
 *
 * Every route 404s outside `NODE_ENV=development` so the surface can
 * never leak in production.
 */
@Controller("dev")
export class DevHubController {
  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  async index(): Promise<string> {
    this.assertDev();
    const features = this.featuresOnly();
    const cfg = serverConfigFromEnv(process.env);
    const links = planDevHub({ env: "development", features });
    const effective = resolveEffectiveBaseUrl({
      baseUrl: cfg.baseUrl,
      port: cfg.port,
      env_vars: {
        ...(process.env.DISABLE_PORTLESS ? { DISABLE_PORTLESS: process.env.DISABLE_PORTLESS } : {}),
        ...(process.env.PORTLESS_ACTIVE ? { PORTLESS_ACTIVE: process.env.PORTLESS_ACTIVE } : {}),
      },
    });
    const candidates = planServiceCandidates({
      baseUrl: effective.publicUrl,
      loopbackUrl: effective.loopbackUrl,
      features,
      env_vars: {
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
        ...(process.env.PRISMA_STUDIO ? { PRISMA_STUDIO: process.env.PRISMA_STUDIO } : {}),
        ...(process.env.NESTJS_DEVTOOLS ? { NESTJS_DEVTOOLS: process.env.NESTJS_DEVTOOLS } : {}),
        ...(process.env.MAILPIT_WEB_URL ? { MAILPIT_WEB_URL: process.env.MAILPIT_WEB_URL } : {}),
        ...(process.env.POWERSYNC_URL ? { POWERSYNC_URL: process.env.POWERSYNC_URL } : {}),
      },
    });
    const probes = await probeServices(candidates, { timeoutMs: 600 });
    return renderHtml(links, probes);
  }

  @Get("status.json")
  async statusJson(): Promise<ServiceProbeResult[]> {
    this.assertDev();
    const features = this.featuresOnly();
    const cfg = serverConfigFromEnv(process.env);
    const effective = resolveEffectiveBaseUrl({
      baseUrl: cfg.baseUrl,
      port: cfg.port,
      env_vars: {
        ...(process.env.DISABLE_PORTLESS ? { DISABLE_PORTLESS: process.env.DISABLE_PORTLESS } : {}),
        ...(process.env.PORTLESS_ACTIVE ? { PORTLESS_ACTIVE: process.env.PORTLESS_ACTIVE } : {}),
      },
    });
    const candidates = planServiceCandidates({
      baseUrl: effective.publicUrl,
      loopbackUrl: effective.loopbackUrl,
      features,
      env_vars: {
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
        ...(process.env.PRISMA_STUDIO ? { PRISMA_STUDIO: process.env.PRISMA_STUDIO } : {}),
        ...(process.env.NESTJS_DEVTOOLS ? { NESTJS_DEVTOOLS: process.env.NESTJS_DEVTOOLS } : {}),
        ...(process.env.MAILPIT_WEB_URL ? { MAILPIT_WEB_URL: process.env.MAILPIT_WEB_URL } : {}),
        ...(process.env.POWERSYNC_URL ? { POWERSYNC_URL: process.env.POWERSYNC_URL } : {}),
      },
    });
    return probeServices(candidates, { timeoutMs: 600 });
  }

  @Get("features")
  features(): Features {
    this.assertDev();
    return this.featuresOnly();
  }

  @Get("postgrest-parse")
  postgrestParse(@Query() query: Record<string, string>): { where: PrismaWhere } {
    this.assertDev();
    // Strips off the controller's own NestJS-overhead query params if any
    // (none today). Returns the parsed Prisma WHERE for inspection.
    return { where: parsePostgrestQuery(query) };
  }

  @Get("coverage")
  @Header("content-type", "text/html; charset=utf-8")
  async coverage(): Promise<string> {
    this.assertDev();
    const repoRoot = process.cwd();
    const path = resolve(repoRoot, "coverage", "coverage-summary.json");
    let summary: RawCoverageSummary | undefined;
    let generatedAt: string | undefined;
    try {
      const buf = await readFile(path, "utf8");
      summary = JSON.parse(buf) as RawCoverageSummary;
      const st = await stat(path);
      generatedAt = st.mtime.toISOString();
    } catch {
      summary = undefined;
    }
    const report = buildCoverageReport({
      repoRoot,
      ...(summary ? { summary } : {}),
      ...(generatedAt ? { generatedAt } : {}),
    });
    return renderCoveragePage(report);
  }

  @Get("logs")
  @Header("content-type", "text/html; charset=utf-8")
  logsPage(): string {
    this.assertDev();
    const buffer = getLogBuffer();
    return renderLogViewerPage({
      records: buffer.recent(200),
      bufferCapacity: buffer.capacity(),
      bufferSize: buffer.size(),
    });
  }

  @Get("logs.json")
  logsJson(@Query("since") since: string | undefined): unknown[] {
    this.assertDev();
    const buffer = getLogBuffer();
    const sinceSeq = Number.parseInt(since ?? "0", 10) || 0;
    return [...buffer.since(sinceSeq)];
  }

  @Get("tests")
  @Header("content-type", "text/html; charset=utf-8")
  async tests(): Promise<string> {
    this.assertDev();
    const repoRoot = process.cwd();
    const path = resolve(repoRoot, "coverage", "test-summary.json");
    let summary: RawTestSummary | undefined;
    let generatedAt: string | undefined;
    try {
      const buf = await readFile(path, "utf8");
      summary = JSON.parse(buf) as RawTestSummary;
      const st = await stat(path);
      generatedAt = st.mtime.toISOString();
    } catch {
      summary = undefined;
    }
    const report = buildTestSummary({
      repoRoot,
      ...(summary ? { summary } : {}),
      ...(generatedAt ? { generatedAt } : {}),
    });
    return renderTestSummaryPage(report);
  }

  @Get("diagnostics")
  diagnostics(): DiagnosticsReport {
    this.assertDev();
    const features = this.featuresOnly();
    const cfg = serverConfigFromEnv(process.env);
    return buildDiagnosticsReport({
      now: () => Date.now(),
      processStartTime: Date.now() - Math.round(process.uptime() * 1000),
      memory: () => {
        const m = process.memoryUsage();
        return {
          rss: m.rss,
          heapTotal: m.heapTotal,
          heapUsed: m.heapUsed,
          external: m.external,
          arrayBuffers: m.arrayBuffers,
        };
      },
      env: {
        nodeVersion: process.versions.node,
        bunVersion: readBunVersion(),
        platform: process.platform,
        arch: process.arch,
      },
      app: {
        env: "development",
        version: APP_VERSION,
        baseUrl: cfg.baseUrl,
      },
      features,
      dependencies: { name: APP_NAME },
    });
  }

  private assertDev(): void {
    const cfg = serverConfigFromEnv(process.env);
    if (cfg.env !== "development") {
      throw new NotFoundException();
    }
  }

  private featuresOnly(): Features {
    return loadFeatures(process.env as Record<string, string | undefined>);
  }
}

const CATEGORY_LABELS: Record<DevHubLink["category"], string> = {
  api: "API",
  architecture: "Architecture",
  data: "Data",
  async: "Async",
};

function renderHtml(
  links: ReadonlyArray<DevHubLink>,
  probes: ReadonlyArray<ServiceProbeResult>,
): string {
  const grouped: Partial<Record<DevHubLink["category"], DevHubLink[]>> = {};
  for (const link of links) {
    (grouped[link.category] ??= []).push(link);
  }
  const sections = Object.entries(grouped)
    .map(([category, list]) => {
      const items = list!
        .map(
          (l) =>
            `        <li><a href="${escapeHtml(l.url)}"><span>${escapeHtml(l.label)}</span><span class="admin-meta">→</span></a></li>`,
        )
        .join("\n");
      return `<div class="admin-card">
  <h2 class="admin-card__title">${escapeHtml(CATEGORY_LABELS[category as DevHubLink["category"]])}</h2>
  <ul class="admin-link-list">
${items}
  </ul>
</div>`;
    })
    .join("\n");

  const body = `
<style>
  .status-grid { display: grid; gap: .85rem; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .status-card {
    background: var(--surface-2); border: 1px solid var(--line);
    border-radius: var(--radius-sm); padding: 1rem 1.15rem;
    display: flex; flex-direction: column; gap: .5rem;
    transition: all .25s var(--ease);
    position: relative; overflow: hidden;
  }
  .status-card::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0;
    width: 2px; background: transparent; transition: background .2s var(--ease);
  }
  .status-card:hover {
    background: var(--surface-3); border-color: var(--line-strong);
    transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.4);
  }
  .status-card[data-status="up"]:hover::before { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
  .status-card[data-status="down"]:hover::before { background: var(--err); }
  .status-card__head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
  .status-card__label { font-weight: 600; color: var(--fg); font-size: .92rem; letter-spacing: -0.005em; }
  .status-dot { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; }
  .status-dot--up { background: var(--ok); box-shadow: 0 0 10px var(--ok); animation: pulse 2s ease-in-out infinite; }
  .status-dot--down { background: var(--err); box-shadow: 0 0 6px rgba(248, 113, 113, .4); }
  .status-dot--unknown { background: var(--fg-faint); }
  .status-card__url { color: var(--fg-dim); font-size: .72rem; font-family: var(--font-mono); word-break: break-all; line-height: 1.5; }
  .status-card__meta { color: var(--fg-faint); font-size: .68rem; display: flex; justify-content: space-between; align-items: center; padding-top: .25rem; border-top: 1px solid var(--line); margin-top: .25rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 500; }
  .status-card__meta span:last-child { color: var(--fg-muted); font-variant-numeric: tabular-nums; }
</style>
<div class="admin-card admin-card--accent">
  <h2 class="admin-card__title">Service-Status</h2>
  <div class="status-grid" data-service-status="true">
${renderStatusCards(probes)}
  </div>
</div>
<div class="admin-grid admin-grid--2">
${sections}
</div>`;
  return renderAdminLayout({
    title: "Dev Hub",
    subtitle: "Central access point for every dev/admin surface this server exposes.",
    currentNav: "dev-hub",
    body,
  });
}

function renderStatusCards(probes: ReadonlyArray<ServiceProbeResult>): string {
  if (probes.length === 0) {
    return `<div class="admin-empty">No services configured.</div>`;
  }
  return probes
    .map((p) => {
      const cls =
        p.status === "up"
          ? "status-dot--up"
          : p.status === "down"
            ? "status-dot--down"
            : "status-dot--unknown";
      const labelText = p.status === "up" ? "online" : p.status === "down" ? "offline" : "unknown";
      const latency = p.latencyMs !== undefined ? `${p.latencyMs} ms` : "";
      const href = p.href ?? p.probeUrl ?? "#";
      const url = p.probeUrl ?? p.href ?? "";
      return `<a class="status-card" href="${escapeHtml(href)}" target="_blank" rel="noopener" data-service-id="${escapeHtml(p.id)}" data-status="${p.status}">
      <div class="status-card__head">
        <span class="status-card__label">${escapeHtml(p.label)}</span>
        <span class="status-dot ${cls}" title="${labelText}"></span>
      </div>
      ${url ? `<span class="status-card__url">${escapeHtml(url)}</span>` : ""}
      <div class="status-card__meta">
        <span>${escapeHtml(labelText)}</span>
        <span>${latency}</span>
      </div>
    </a>`;
    })
    .join("\n");
}

function readBunVersion(): string | undefined {
  const bun = (globalThis as { Bun?: { version: string } }).Bun;
  return bun?.version;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
