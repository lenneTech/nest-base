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
    const candidates = planServiceCandidates({
      baseUrl: cfg.baseUrl,
      loopbackUrl: `http://localhost:${cfg.port}`,
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
    const candidates = planServiceCandidates({
      baseUrl: cfg.baseUrl,
      loopbackUrl: `http://localhost:${cfg.port}`,
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
  .status-grid { display: grid; gap: .85rem; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
  .status-card { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: .85rem 1rem; display: flex; flex-direction: column; gap: .35rem; transition: border-color .12s; }
  .status-card:hover { border-color: var(--border-strong); }
  .status-card__head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
  .status-card__label { font-weight: 600; color: var(--text); }
  .status-dot { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; }
  .status-dot--up { background: var(--success); box-shadow: 0 0 8px var(--success); }
  .status-dot--down { background: var(--danger); }
  .status-dot--unknown { background: var(--text-dim); }
  .status-card__url { color: var(--text-muted); font-size: .75rem; font-family: ui-monospace, monospace; word-break: break-all; }
  .status-card__meta { color: var(--text-dim); font-size: .7rem; display: flex; justify-content: space-between; }
</style>
<div class="admin-card">
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
      return `<a class="status-card" href="${escapeHtml(href)}" target="_blank" rel="noopener" data-service-id="${escapeHtml(p.id)}">
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
