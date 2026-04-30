import { createReadStream } from "node:fs";
import { readFile, stat, utimes, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import { type Features, loadFeatures } from "../features/features.js";
import { parsePostgrestQuery } from "../permissions/postgrest-query.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { APP_NAME, APP_VERSION } from "../app/app.metadata.js";
import { buildCoverageReport, type RawCoverageSummary } from "./coverage-report.js";
import { renderCoveragePage } from "./coverage-ui.js";
import { renderDashboardPage } from "./dashboard-ui.js";
import { buildDevPortalShellInput, renderDevPortalShell } from "./dev-portal-shell.js";
import { renderDiagnosticsPage } from "./diagnostics-ui.js";
import { resolveEffectiveBaseUrl } from "./effective-base-url.js";
import { planEnvFileUpdate } from "./env-file-update.js";
import { FEATURE_CATALOG } from "./feature-catalog.js";
import { renderFeaturesPage } from "./features-ui.js";
import { renderJsonViewerPage } from "./json-viewer-ui.js";
import { buildDiagnosticsReport, type DiagnosticsReport } from "./diagnostics.js";
import {
  buildEmailPreviewCatalog,
  renderEmailPreview,
  type EmailPreviewResult,
} from "./email-preview.js";
import { renderEmailPreviewPage } from "./email-preview-ui.js";
import { buildErdForProject } from "./erd-runner.js";
import { renderErdPage } from "./erd-ui.js";
import {
  EjsEmailTemplateRenderer,
  buildBuiltInEmailTemplateRegistry,
} from "../email/email-templates.js";
import { getLogBuffer } from "./log-buffer.js";
import { renderLogViewerPage } from "./log-viewer-ui.js";
import { RouteInventoryService } from "./route-inventory-runner.js";
import { renderRouteInventoryPage } from "./route-inventory-ui.js";
import type { RouteInventory } from "./route-inventory.js";
import {
  getQueryBuffer,
  type QueryRecord,
  type QuerySummary,
  type TemplateGroup,
} from "./query-buffer.js";
import { renderQueryViewerPage } from "./query-viewer-ui.js";
import { getTraceBuffer, type TraceRecord, type TraceSummary } from "./trace-buffer.js";
import { renderTraceViewerPage } from "./trace-viewer-ui.js";
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
  constructor(private readonly routes: RouteInventoryService) {}

  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  index(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Dev Portal" }));
  }

  /**
   * `/dev/components` — react-aria-components living style guide. Same
   * SPA shell as `/dev`; client-side router decides which page to render.
   */
  @Get("components")
  @Header("content-type", "text/html; charset=utf-8")
  componentsPage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Components" }));
  }

  /**
   * Legacy server-rendered cockpit. Kept available at `/dev/cockpit`
   * so the live coverage / tests / log preview surface that the React
   * SPA hasn't replaced yet stays one click away.
   */
  @Get("cockpit")
  @Header("content-type", "text/html; charset=utf-8")
  async cockpit(): Promise<string> {
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
        ...(process.env.MAILPIT_WEB_URL ? { MAILPIT_WEB_URL: process.env.MAILPIT_WEB_URL } : {}),
        ...(process.env.POWERSYNC_URL ? { POWERSYNC_URL: process.env.POWERSYNC_URL } : {}),
      },
    });
    const repoRoot = process.cwd();

    const [probes, coverage, tests] = await Promise.all([
      probeServices(candidates, { timeoutMs: 600 }),
      this.readCoverageSummary(repoRoot),
      this.readTestSummary(repoRoot),
    ]);

    const buffer = getLogBuffer();
    const mem = process.memoryUsage();
    return renderDashboardPage({
      baseUrl: effective.publicUrl,
      uptimeMs: Math.round(process.uptime() * 1000),
      memory: { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss },
      process: {
        node: process.versions.node,
        ...(readBunVersion() ? { bun: readBunVersion()! } : {}),
        platform: process.platform,
      },
      features,
      probes,
      coverage,
      tests,
      logs: buffer.recent(50),
      logBufferCapacity: buffer.capacity(),
      queries: getQueryBuffer().summary(),
    });
  }

  /**
   * `/dev/static/:filename` — serves the bundled SPA assets from
   * `dist/dev-portal/`. `assertDev()` ensures the route 404s outside
   * development (no production-leak risk for the source-mapped bundle).
   */
  @Get("static/:filename")
  serveStatic(@Param("filename") filename: string, @Res() res: Response): void {
    this.assertDev();
    if (!isSafeStaticName(filename)) {
      throw new NotFoundException();
    }
    const filePath = resolve(process.cwd(), "dist/dev-portal", filename);
    if (!filePath.startsWith(resolve(process.cwd(), "dist/dev-portal"))) {
      throw new NotFoundException();
    }
    const mime = mimeForExtension(filename);
    res.type(mime);
    const stream = createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.status(404).type("application/json").send({ error: "not_found" });
      }
    });
    stream.pipe(res);
  }

  private async readCoverageSummary(repoRoot: string) {
    const path = resolve(repoRoot, "reports", "coverage", "coverage-summary.json");
    try {
      const buf = await readFile(path, "utf8");
      const summary = JSON.parse(buf) as RawCoverageSummary;
      const st = await stat(path);
      return buildCoverageReport({ repoRoot, summary, generatedAt: st.mtime.toISOString() });
    } catch {
      return buildCoverageReport({ repoRoot });
    }
  }

  private async readTestSummary(repoRoot: string) {
    const path = resolve(repoRoot, "coverage", "test-summary.json");
    try {
      const buf = await readFile(path, "utf8");
      const summary = JSON.parse(buf) as RawTestSummary;
      const st = await stat(path);
      return buildTestSummary({ repoRoot, summary, generatedAt: st.mtime.toISOString() });
    } catch {
      return buildTestSummary({ repoRoot });
    }
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
        ...(process.env.MAILPIT_WEB_URL ? { MAILPIT_WEB_URL: process.env.MAILPIT_WEB_URL } : {}),
        ...(process.env.POWERSYNC_URL ? { POWERSYNC_URL: process.env.POWERSYNC_URL } : {}),
      },
    });
    return probeServices(candidates, { timeoutMs: 600 });
  }

  @Get("features")
  @Header("content-type", "text/html; charset=utf-8")
  features(): string {
    this.assertDev();
    return renderFeaturesPage(this.featuresOnly());
  }

  @Get("features.json")
  featuresJson(): Features {
    this.assertDev();
    return this.featuresOnly();
  }

  @Post("features/:key/toggle")
  @HttpCode(200)
  async toggleFeature(
    @Param("key") key: string,
    @Body() body: { enabled?: unknown },
  ): Promise<{ ok: true; key: string; enabled: boolean; envKey: string; restart: true }> {
    this.assertDev();
    const meta = FEATURE_CATALOG.find((f) => f.key === key);
    if (!meta) {
      throw new BadRequestException(`unknown feature key: ${key}`);
    }
    if (typeof body?.enabled !== "boolean") {
      throw new BadRequestException("body.enabled must be boolean");
    }
    const repoRoot = process.cwd();
    const envPath = resolve(repoRoot, ".env");
    let current = "";
    try {
      current = await readFile(envPath, "utf8");
    } catch {
      // .env does not exist yet — start fresh.
    }
    const plan = planEnvFileUpdate({
      current,
      key: meta.envKey,
      value: body.enabled ? "true" : "false",
    });
    await writeFile(envPath, plan.next, "utf8");
    // Touch src/main.ts so `bun --watch` picks up the change and restarts
    // the API; loadFeatures() then re-reads .env. Without this, the env
    // file is dirty but features stay stale until manual restart.
    try {
      const mainPath = resolve(repoRoot, "src", "main.ts");
      const now = new Date();
      await utimes(mainPath, now, now);
    } catch {
      /* not fatal — file watching is opportunistic */
    }
    return {
      ok: true,
      key: meta.key,
      enabled: body.enabled,
      envKey: meta.envKey,
      restart: true,
    };
  }

  @Get("postgrest-parse")
  postgrestParse(
    @Query() query: Record<string, string>,
    @Headers("accept") accept: string | undefined,
    @Res() res: Response,
  ): void {
    this.assertDev();
    const { format, ...filterQuery } = query;
    const parsed = parsePostgrestQuery(filterQuery);
    const data = { where: parsed, query: filterQuery };
    if (devWantsJson(accept, format)) {
      res.type("application/json").send(JSON.stringify(data));
      return;
    }
    const rawJsonHref =
      Object.keys(filterQuery).length === 0
        ? "/dev/postgrest-parse?format=json"
        : `/dev/postgrest-parse?${new URLSearchParams({ ...filterQuery, format: "json" }).toString()}`;
    const prelude =
      Object.keys(filterQuery).length === 0
        ? '<p class="admin-meta">Try <a href="/dev/postgrest-parse?status=eq.draft&age=gte.18">?status=eq.draft&age=gte.18</a> to see how PostgREST-style filters map to a Prisma WHERE clause.</p>'
        : "";
    res.type("text/html; charset=utf-8").send(
      renderJsonViewerPage({
        title: "PostgREST Parser",
        subtitle: "Mapping of `?key=op.value` query strings to a Prisma `where` clause.",
        currentNav: "postgrest-parse",
        prelude,
        value: data,
        rawJsonHref,
      }),
    );
  }

  @Get("coverage")
  @Header("content-type", "text/html; charset=utf-8")
  async coverage(): Promise<string> {
    this.assertDev();
    const repoRoot = process.cwd();
    const path = resolve(repoRoot, "reports", "coverage", "coverage-summary.json");
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
  @Header("content-type", "text/html; charset=utf-8")
  diagnostics(): string {
    this.assertDev();
    return renderDiagnosticsPage(this.buildDiagnostics());
  }

  @Get("diagnostics.json")
  diagnosticsJson(): DiagnosticsReport {
    this.assertDev();
    return this.buildDiagnostics();
  }

  @Get("routes")
  @Header("content-type", "text/html; charset=utf-8")
  routesPage(): string {
    this.assertDev();
    return renderRouteInventoryPage(this.routes.build());
  }

  @Get("routes.json")
  routesJson(): RouteInventory {
    this.assertDev();
    return this.routes.build();
  }

  @Get("erd")
  @Header("content-type", "text/html; charset=utf-8")
  erdPage(): string {
    this.assertDev();
    return renderErdPage(buildErdForProject());
  }

  @Get("erd.json")
  erdJson(): { mermaid: string; modelCount: number; relationCount: number } {
    this.assertDev();
    return buildErdForProject();
  }

  @Get("traces")
  @Header("content-type", "text/html; charset=utf-8")
  tracesPage(): string {
    this.assertDev();
    const buffer = getTraceBuffer();
    return renderTraceViewerPage({
      traces: buffer.recent({ limit: 100 }),
      summary: buffer.summary(),
    });
  }

  @Get("traces.json")
  tracesJson(
    @Query("limit") limit?: string,
    @Query("requestId") requestId?: string,
  ): {
    traces: TraceRecord[];
    summary: TraceSummary;
  } {
    this.assertDev();
    const buffer = getTraceBuffer();
    const filter: { limit?: number; requestId?: string } = {};
    if (limit) {
      const parsed = Number.parseInt(limit, 10);
      if (Number.isFinite(parsed) && parsed > 0) filter.limit = parsed;
    }
    if (requestId) filter.requestId = requestId;
    return { traces: buffer.recent(filter), summary: buffer.summary() };
  }

  @Get("queries")
  @Header("content-type", "text/html; charset=utf-8")
  queriesPage(): string {
    this.assertDev();
    const buffer = getQueryBuffer();
    return renderQueryViewerPage({
      recent: buffer.recent({ limit: 100 }),
      slowest: buffer.slowest(10),
      topTemplates: buffer.topTemplates(10),
      summary: buffer.summary(),
    });
  }

  @Get("queries.json")
  queriesJson(
    @Query("limit") limit?: string,
    @Query("requestId") requestId?: string,
  ): {
    recent: QueryRecord[];
    slowest: QueryRecord[];
    topTemplates: TemplateGroup[];
    summary: QuerySummary;
  } {
    this.assertDev();
    const buffer = getQueryBuffer();
    const filter: { limit?: number; requestId?: string } = {};
    if (limit) {
      const parsed = Number.parseInt(limit, 10);
      if (Number.isFinite(parsed) && parsed > 0) filter.limit = parsed;
    }
    if (requestId) filter.requestId = requestId;
    return {
      recent: buffer.recent(filter),
      slowest: buffer.slowest(10),
      topTemplates: buffer.topTemplates(10),
      summary: buffer.summary(),
    };
  }

  @Get("email-preview")
  @Header("content-type", "text/html; charset=utf-8")
  async emailPreviewPage(): Promise<string> {
    this.assertDev();
    const renderer = new EjsEmailTemplateRenderer(buildBuiltInEmailTemplateRegistry());
    const catalog = buildEmailPreviewCatalog();
    const rendered: Record<string, EmailPreviewResult> = {};
    for (const entry of catalog.entries) {
      rendered[entry.template] = await renderEmailPreview({
        renderer,
        template: entry.template,
        locale: "en",
        payload: entry.samplePayload,
      });
    }
    return renderEmailPreviewPage({ catalog, rendered });
  }

  @Get("email-preview.json")
  async emailPreviewJson(): Promise<{
    catalog: ReturnType<typeof buildEmailPreviewCatalog>;
    rendered: Record<string, EmailPreviewResult>;
  }> {
    this.assertDev();
    const renderer = new EjsEmailTemplateRenderer(buildBuiltInEmailTemplateRegistry());
    const catalog = buildEmailPreviewCatalog();
    const rendered: Record<string, EmailPreviewResult> = {};
    for (const entry of catalog.entries) {
      rendered[entry.template] = await renderEmailPreview({
        renderer,
        template: entry.template,
        locale: "en",
        payload: entry.samplePayload,
      });
    }
    return { catalog, rendered };
  }

  private buildDiagnostics(): DiagnosticsReport {
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

  /**
   * Catch-all for `/dev/*` paths that don't match a more specific
   * handler. Always returns the SPA shell — react-router on the client
   * decides what to render. NestJS dispatches to the most specific
   * route first, so the explicit `@Get('features')`, `@Get('logs')`,
   * `@Get('static/:filename')`, etc. always win over this fallback.
   *
   * 404s outside development just like every other route in the
   * controller, so the SPA shell never leaks in production.
   */
  @Get("*splat")
  @Header("content-type", "text/html; charset=utf-8")
  spaCatchAll(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Dev Portal" }));
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

function readBunVersion(): string | undefined {
  const bun = (globalThis as { Bun?: { version: string } }).Bun;
  return bun?.version;
}

function devWantsJson(accept: string | undefined, format: string | undefined): boolean {
  if (format === "json") return true;
  if (format === "html") return false;
  if (!accept) return false;
  const lower = accept.toLowerCase();
  if (lower.includes("text/html")) return false;
  if (lower.includes("application/json")) return true;
  return false;
}

/**
 * Whitelist filenames that the `/dev/static/*` handler is allowed to
 * serve — bundle outputs (main.js, main.css, tokens.css, plus any
 * `chunks/*.js` Bun emits with content-hashed names).
 *
 * The check is allow-list based: any path-traversal attempt
 * (`../`, absolute paths, weird characters) is rejected before it
 * reaches the filesystem.
 */
function isSafeStaticName(name: string): boolean {
  if (!name || name.length > 256) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.startsWith(".")) return false;
  return /^[a-zA-Z0-9._-]+\.(js|css|map|svg|woff2?)$/.test(name);
}

function mimeForExtension(name: string): string {
  if (name.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (name.endsWith(".css")) return "text/css; charset=utf-8";
  if (name.endsWith(".map")) return "application/json; charset=utf-8";
  if (name.endsWith(".svg")) return "image/svg+xml";
  if (name.endsWith(".woff2")) return "font/woff2";
  if (name.endsWith(".woff")) return "font/woff";
  return "application/octet-stream";
}
