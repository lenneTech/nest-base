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
import { renderDiagnosticsPage } from "./diagnostics-ui.js";
import { resolveEffectiveBaseUrl } from "./effective-base-url.js";
import { planEnvFileUpdate } from "./env-file-update.js";
import { FEATURE_CATALOG } from "./feature-catalog.js";
import { renderFeaturesPage } from "./features-ui.js";
import { renderJsonViewerPage } from "./json-viewer-ui.js";
import { buildDiagnosticsReport, type DiagnosticsReport } from "./diagnostics.js";
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
    });
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
