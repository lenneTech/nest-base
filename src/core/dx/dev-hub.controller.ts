import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import {
  __clearBrandCache,
  loadBrandSync,
  resolveBrandPaths,
  type BrandConfig,
} from "../branding/brand-loader.js";
import { decodeBrand } from "../branding/brand-schema.js";
import { readTunnelState } from "../dev/tunnel-state-runner.js";
import { MigrationsService } from "./migrations/migrations.service.js";

import { type Features, loadFeatures } from "../features/features.js";
import {
  type WebhookEventMetadata,
  getRegisteredWebhookEvents,
} from "../webhooks/webhook-event.decorator.js";
import {
  SCHEDULED_JOB_REGISTRY,
  type ScheduledJobRegistry,
} from "../jobs/scheduled-job.registry.js";
import { EMAIL_OUTBOX_STORAGE } from "../email/email-outbox.module.js";
import type { EmailOutboxStorage } from "../email/email-outbox.js";
import { classifyEmailOutboxLag } from "../email/email-outbox-health.js";
import { JobNotFoundError, JobNotRetryableError, type ListJobsOptions } from "../jobs/job-queue.js";
import type { JobState } from "../jobs/dev-jobs-aggregations.js";
import { JobQueueService } from "../jobs/jobs.module.js";
import { parsePostgrestQuery } from "../permissions/postgrest-query.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { APP_NAME, APP_VERSION } from "../app/app.metadata.js";
import { buildCoverageReport, type RawCoverageSummary } from "./coverage-report.js";
import { buildDevPortalShellInput, renderDevPortalShell } from "./dev-portal-shell.js";
import { resolveEffectiveBaseUrl } from "./effective-base-url.js";
import { planEnvFileUpdate } from "./env-file-update.js";
import { FEATURE_CATALOG } from "./feature-catalog.js";
import { buildDiagnosticsReport, type DiagnosticsReport } from "./diagnostics.js";
import {
  buildEmailPreviewCatalog,
  renderEmailPreview,
  type EmailPreviewResult,
} from "./email-preview.js";
import { buildErdForProject } from "./erd-runner.js";
import {
  KNOWN_EMAIL_BLOCKS,
  KNOWN_EMAIL_LAYOUTS,
  composeEmailTemplateSource,
  decomposeTemplateSource,
  isValidEmailTemplateLocale,
  isValidEmailTemplateSlug,
  resolveEmailTemplateTarget,
  validateEmailComposition,
  type EmailComposition,
} from "../email/email-builder.js";
import { renderEmailComposition } from "../email/email-builder-runtime.js";
import {
  ReactEmailTemplateRenderer,
  discoverReactEmailTemplates,
} from "../email/email-templates.react.js";
import { resolveBrandConfig } from "../email/brand.js";
import { getLogBuffer } from "./log-buffer.js";
import { RouteInventoryService } from "./route-inventory-runner.js";
import type { RouteInventory } from "./route-inventory.js";
import {
  getQueryBuffer,
  type QueryRecord,
  type QuerySummary,
  type TemplateGroup,
} from "./query-buffer.js";
import { getTraceBuffer, type TraceRecord, type TraceSummary } from "./trace-buffer.js";
import { buildTestSummary, type RawTestSummary } from "./test-summary.js";
import { planServiceCandidates, probeServices, type ServiceProbeResult } from "./service-status.js";
import {
  buildDashboardStatusGroups,
  type DashboardStatusGroup,
} from "./dashboard-health-planner.js";
import {
  searchPalettePages,
  type PalettePageEntry,
  type PaletteSearchResult,
} from "./palette-search-planner.js";
import { Public } from "../permissions/public.decorator.js";

/**
 * `/hub/*` — Developer-only landing + JSON inspection routes.
 *
 * - `GET /dev`             — HTML landing page (categorised tool links)
 * - `GET /hub/features`    — active Features object as JSON
 * - `GET /hub/diagnostics` — runtime + memory + features report
 *
 * Every route 404s outside `NODE_ENV=development` so the surface can
 * never leak in production.
 */
@Controller("hub")
export class DevHubController {
  constructor(
    private readonly routes: RouteInventoryService,
    private readonly migrations: MigrationsService,
    private readonly jobs: JobQueueService,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly scheduledJobs: ScheduledJobRegistry,
    @Optional() @Inject(EMAIL_OUTBOX_STORAGE) private readonly emailOutbox?: EmailOutboxStorage,
  ) {}

  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  index(): string {
    this.assertDev();
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Dev Portal", brand: "central" }),
    );
  }

  /**
   * `/hub/components` — react-aria-components living style guide. Same
   * SPA shell as `/hub`; client-side router decides which page to render.
   */
  @Get("components")
  @Header("content-type", "text/html; charset=utf-8")
  componentsPage(): string {
    this.assertDev();
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Components", brand: "central" }),
    );
  }

  /**
   * `/hub/static/:filename` — serves the bundled SPA assets from
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

  /**
   * `/hub/dashboard.json` — aggregate the React `/hub` landing needs.
   * One request → all the data the hero / stats grid / services / log
   * preview / feature overview need, so the SPA never fans out into
   * 8 sibling fetches on the first paint.
   */
  @Get("dashboard.json")
  async dashboardJson(): Promise<unknown> {
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
    const tunnelState = readTunnelState(process.cwd());

    // Gather data for the operator health planner
    const migrationsStatus = await this.migrations.getStatus();
    const allMigrationsApplied =
      migrationsStatus.pending.length === 0 && migrationsStatus.failed.length === 0;

    const statusGroups: DashboardStatusGroup[] = buildDashboardStatusGroups({
      uptime: process.uptime(),
      heapUsedMb: mem.heapUsed / 1e6,
      rssMb: mem.rss / 1e6,
      bunVersion: readBunVersion() ?? "",
      pendingJobCount: 0,
      deadLetterCount: 0,
      webhookSuccessRate: 1,
      emailEnabled: Boolean(features.email?.enabled),
      storageDriverName:
        (features as Record<string, unknown> & { storageDefault?: string }).storageDefault ??
        "local",
      geoIpAgeDays: 0,
      allMigrationsApplied,
      // RLS is active when row-level security is enforced in the DB.
      // We infer it from the presence of multi-tenancy feature, since RLS
      // is always enabled alongside multi-tenancy in this template.
      rlsActive: Boolean(
        (features as Record<string, unknown> & { multiTenancy?: { enabled?: boolean } })
          .multiTenancy?.enabled,
      ),
    });

    // Stub chart data — no request log aggregation implemented yet.
    // The UI renders a "Kein Datenmaterial" placeholder when available=false.
    const requestsChart = { available: false as const, buckets: buildZeroFilledRequestBuckets() };
    const sessionsChart = { available: false as const, buckets: buildZeroFilledSessionBuckets() };
    const geoTopCountries = {
      available: false as const,
      countries: [] as Array<{ countryCode: string; country: string; requests: number }>,
    };

    return {
      baseUrl: effective.publicUrl,
      uptimeMs: Math.round(process.uptime() * 1000),
      memory: { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss },
      process: {
        node: process.versions.node,
        ...(readBunVersion() ? { bun: readBunVersion()! } : {}),
        platform: process.platform,
      },
      features,
      catalog: FEATURE_CATALOG,
      probes,
      coverage,
      tests,
      logs: buffer.recent(50),
      logBufferCapacity: buffer.capacity(),
      queries: getQueryBuffer().summary(),
      tunnel: tunnelState
        ? { active: true as const, url: tunnelState.url, startedAt: tunnelState.startedAt }
        : { active: false as const },
      statusGroups,
      requestsChart,
      sessionsChart,
      geoTopCountries,
    };
  }

  /**
   * `/hub/tunnel.json` — surfaces the active Cloudflare-Tunnel URL
   * the dev runner discovered. Reads the JSON state file at
   * `node_modules/.cache/nest-base/tunnel.json`, which `scripts/dev.ts`
   * writes when `--tunnel` is set and `cloudflared` reports a public
   * URL. Returns `{ active: false }` when no tunnel is running so the
   * Dev-Hub UI can render a clean "no tunnel" state.
   */
  @Get("tunnel.json")
  tunnelJson(): { active: false } | { active: true; url: string; startedAt: string } {
    this.assertDev();
    const state = readTunnelState(process.cwd());
    if (state === null) return { active: false };
    return { active: true, url: state.url, startedAt: state.startedAt };
  }

  /**
   * `/hub/brand.json` — returns the effective brand config (project
   * overlay → template default → schema built-in). The dev-portal
   * SPA fetches this lazily; the shell HTML inlines the same value
   * as `window.__BRAND__` for first-paint correctness.
   *
   * 404 outside development like every other DX route.
   */
  @Get("brand.json")
  brandJson(): BrandConfig {
    this.assertDev();
    return loadBrandSync(process.cwd());
  }

  /**
   * `/hub/brand` — SPA shell for the brand editor page. The React
   * route fetches `/hub/brand.json` to populate the form and posts
   * back to `/hub/brand` to write `src/modules/branding/brand.json`.
   */
  @Get("brand")
  @Header("content-type", "text/html; charset=utf-8")
  brandPage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Brand", brand: "central" }));
  }

  /**
   * `POST /hub/brand` — writes the project overlay
   * `src/modules/branding/brand.json`. The body must validate
   * against `BrandConfigSchema`; on success the brand-loader cache
   * is dropped so the next read reflects the new value.
   *
   * The dev runner's `brand.json` watcher (scripts/dev.ts) detects
   * the file change and triggers a full process restart — this
   * keeps modules that read the brand at provider init (Better-Auth,
   * EmailModule, OpenAPI builder) in sync with the new values.
   */
  @Post("brand")
  @HttpCode(200)
  async saveBrand(@Body() body: unknown): Promise<{ ok: true; brand: BrandConfig }> {
    this.assertDev();
    let parsed: BrandConfig;
    try {
      parsed = decodeBrand(body);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const paths = resolveBrandPaths(process.cwd());
    // First-write: the project may have never created
    // src/modules/branding/. mkdir({ recursive: true }) is idempotent
    // and avoids ENOENT on writeFile in fresh checkouts (CI containers,
    // newly-cloned consumer projects).
    await mkdir(dirname(paths.overlayPath), { recursive: true });
    await writeFile(paths.overlayPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
    __clearBrandCache();
    return { ok: true, brand: parsed };
  }

  /**
   * `POST /hub/brand/reset` — deletes the project overlay so the
   * brand falls back to the template default. Idempotent: missing
   * file is a no-op (HTTP 200 + acted: false).
   */
  @Post("brand/reset")
  @HttpCode(200)
  async resetBrand(): Promise<{ ok: true; acted: boolean }> {
    this.assertDev();
    const paths = resolveBrandPaths(process.cwd());
    let acted = false;
    try {
      await rm(paths.overlayPath, { force: true });
      acted = true;
    } catch {
      // File didn't exist — fall through with acted=false. The
      // runner's force flag would normally swallow this anyway, but
      // we keep the try/catch for clarity around the idempotent path.
    }
    __clearBrandCache();
    return { ok: true, acted };
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
    // SPA shell — the React `/hub/features` page fetches
    // `/hub/feature-catalog.json` and renders the same DOM the
    // legacy `renderFeaturesPage` produced. The legacy renderer
    // remains available at `/hub/features.html` as the pixel-fidelity
    // reference but is no longer the canonical surface.
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Features", brand: "central" }));
  }

  @Get("features.json")
  featuresJson(): Features {
    this.assertDev();
    return this.featuresOnly();
  }

  /**
   * `/hub/feature-catalog.json` — feature roster + descriptions used
   * by the React `/hub/features` page. Server-rendered HTML inlines
   * `FEATURE_CATALOG`; the SPA needs an API for it. The shape mirrors
   * `FEATURE_CATALOG` directly so a UI change requires no protocol
   * negotiation — add a field there, surface it here.
   */
  @Get("feature-catalog.json")
  featureCatalogJson(): { catalog: typeof FEATURE_CATALOG; features: Features } {
    this.assertDev();
    return { catalog: FEATURE_CATALOG, features: this.featuresOnly() };
  }

  /**
   * `/hub/scheduled-jobs.json` — surfaces the runtime
   * `ScheduledJobRegistry` (CF.JOBS.02). Each entry mirrors the
   * registry's contract: `name`, `cron`, `source`
   * (`<ClassName>.<methodName>`). The DiscoveryService walk happens at
   * `OnApplicationBootstrap`, so by the time this endpoint is hit the
   * inventory is complete + fixed for the lifetime of the app.
   */
  @Get("scheduled-jobs.json")
  scheduledJobsJson(): {
    jobs: Array<{ name: string; cron: string; source: string }>;
  } {
    this.assertDev();
    const jobs = this.scheduledJobs.list().map((entry) => ({
      name: entry.name,
      cron: entry.cron,
      source: entry.source,
    }));
    return { jobs };
  }

  /**
   * `/hub/webhook-events.json` — surfaces the @WebhookEvent registry
   * (CF.WH.04). The dev-portal "Available webhook events" panel
   * consumes this so a project administrator can see which events
   * are emit-able without grepping the source. Each entry mirrors
   * the canonical `WebhookEventMetadata` shape: `name`,
   * `description?`, `version`, `permission?`. The dispatcher's
   * runtime validation reads from the same registry — the two stay
   * in sync by construction.
   */
  @Get("webhook-events.json")
  webhookEventsJson(): { events: readonly WebhookEventMetadata[] } {
    this.assertDev();
    return { events: getRegisteredWebhookEvents() };
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
    // The HTML branch is now served by the SPA shell — the React
    // `/hub/postgrest-parse` page fetches the same handler with
    // `?format=json` and renders the parsed where-clause through the
    // JSON viewer component (still pixel-faithful to the legacy
    // `renderJsonViewerPage`). This keeps the dev-portal SPA the
    // single owner of the dev-hub chrome.
    res
      .type("text/html; charset=utf-8")
      .send(
        renderDevPortalShell(
          buildDevPortalShellInput({ title: "PostgREST Parser", brand: "central" }),
        ),
      );
  }

  @Get("coverage")
  @Header("content-type", "text/html; charset=utf-8")
  coverage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Coverage", brand: "central" }));
  }

  /** JSON sibling for the React `/hub/coverage` page. */
  @Get("coverage.json")
  async coverageJson(): Promise<unknown> {
    this.assertDev();
    return this.readCoverageSummary(process.cwd());
  }

  @Get("logs")
  @Header("content-type", "text/html; charset=utf-8")
  logsPage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Logs", brand: "central" }));
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
  tests(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Tests", brand: "central" }));
  }

  /** JSON sibling for the React `/hub/tests` page. */
  @Get("tests.json")
  async testsJson(): Promise<unknown> {
    this.assertDev();
    return this.readTestSummary(process.cwd());
  }

  @Get("diagnostics")
  @Header("content-type", "text/html; charset=utf-8")
  diagnostics(): string {
    this.assertDev();
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Diagnostics", brand: "central" }),
    );
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
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Routes", brand: "central" }));
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
    return renderDevPortalShell(buildDevPortalShellInput({ title: "ERD", brand: "central" }));
  }

  /**
   * `/hub/json` — paste-text-render JSON viewer (PRD line 145). The
   * SPA-side `JsonViewerPage` lets developers paste arbitrary JSON
   * and inspect the parsed structure through the same `JsonViewer`
   * component the rest of the dev portal uses. No JSON endpoint —
   * the parsing happens client-side.
   */
  @Get("json")
  @Header("content-type", "text/html; charset=utf-8")
  jsonViewerPage(): string {
    this.assertDev();
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "JSON Viewer", brand: "central" }),
    );
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
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Traces", brand: "central" }));
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
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Queries", brand: "central" }));
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
  emailPreviewPage(): string {
    this.assertDev();
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Email Preview", brand: "central" }),
    );
  }

  @Get("email-preview.json")
  async emailPreviewJson(): Promise<{
    catalog: ReturnType<typeof buildEmailPreviewCatalog>;
    rendered: Record<string, EmailPreviewResult>;
  }> {
    this.assertDev();
    // PRD § Out of Scope bans EJS — `/hub/email-preview` runs the
    // ReactEmailTemplateRenderer (the same path production code uses
    // through `EmailService.sendTemplate`) so the preview reflects
    // the real rendering pipeline. Brand config is resolved once per
    // request to mirror live behaviour.
    const renderer = new ReactEmailTemplateRenderer({ brand: resolveBrandConfig() });
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

  // -----------------------------------------------------------------
  // /dev/email-builder · Issue #9 — Layout-Designer + Children-Composer
  // -----------------------------------------------------------------

  /** SPA shell for `/hub/email-builder`. */
  @Get("email-builder")
  @Header("content-type", "text/html; charset=utf-8")
  emailBuilderPage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Email Builder" }));
  }

  /**
   * `/hub/email-builder/templates.json` — discovered templates with
   * sample-rendered subjects so the Gallery can render thumbnails
   * without a second round-trip.
   */
  @Get("email-builder/templates.json")
  async emailBuilderTemplatesJson(): Promise<{
    templates: Array<{
      name: string;
      locale: string | null;
      file: string;
      source: "core" | "module";
      subject?: string;
      error?: string;
      /** Module-overlay row that shadows a same-named core template. */
      overridesCore?: boolean;
      /** Core row whose name + locale also has a module overlay. */
      overrideExists?: boolean;
    }>;
  }> {
    this.assertDev();
    const discovered = await discoverReactEmailTemplates();
    const renderer = new ReactEmailTemplateRenderer({ brand: resolveBrandConfig() });
    const catalog = buildEmailPreviewCatalog();
    const sampleByName = new Map(catalog.entries.map((e) => [e.template, e.samplePayload]));
    // Index module-overlay rows so we can flag the matching core rows
    // (and the overlay rows themselves) without an O(n²) scan in the UI.
    // Issue #49 — the gallery surfaces "Core (overridden)" / "Module
    // overlay" badges; the precedence reflects the runtime resolver.
    const overlayKeys = new Set<string>(
      discovered.filter((t) => t.source === "module").map((t) => `${t.name}::${t.locale ?? ""}`),
    );
    const out: Array<{
      name: string;
      locale: string | null;
      file: string;
      source: "core" | "module";
      subject?: string;
      error?: string;
      overridesCore?: boolean;
      overrideExists?: boolean;
    }> = [];
    for (const tpl of discovered) {
      const sample = sampleByName.get(tpl.name) ?? {};
      const key = `${tpl.name}::${tpl.locale ?? ""}`;
      const flags: { overridesCore?: boolean; overrideExists?: boolean } = {};
      if (tpl.source === "module") {
        // Heuristic: module overlay shadows a core template if the
        // core inventory has the same name + locale. We can compute
        // this by re-scanning the discovery list; the cost is
        // negligible (≤ 10 entries in practice).
        const coreMatch = discovered.find(
          (other) =>
            other.source === "core" && other.name === tpl.name && other.locale === tpl.locale,
        );
        if (coreMatch) flags.overridesCore = true;
      } else if (overlayKeys.has(key)) {
        flags.overrideExists = true;
      }
      try {
        const rendered = await renderer.render(tpl.name, tpl.locale ?? "en", sample);
        out.push({ ...tpl, subject: rendered.subject, ...flags });
      } catch (err) {
        out.push({ ...tpl, error: asMessage(err), ...flags });
      }
    }
    return { templates: out };
  }

  /**
   * `GET /hub/email-builder/templates/:name/composition.json` — read
   * a discovered template's `.tsx` source and decompose it back into
   * the JSON composition the builder UI consumes. Issue #49.
   *
   * The endpoint resolves the template via the same precedence rules
   * the runtime renderer uses (module overlay > core, locale-specific
   * > default). When the source falls inside the composer grammar,
   * the response includes `decomposable: true` + `composition`. When
   * it's hand-rolled (custom JSX, ternaries, etc.), the response is
   * `decomposable: false` + `reason` so the UI can render a read-only
   * source view instead of a broken composer.
   *
   * The raw `.tsx` source is always returned alongside so the UI
   * can show "View source" even on decomposable templates.
   */
  @Get("email-builder/templates/:name/composition.json")
  async emailBuilderTemplateComposition(
    @Param("name") name: string,
    @Query("locale") locale: string | undefined,
  ): Promise<{
    name: string;
    locale: string | null;
    source: "core" | "module";
    file: string;
    rawSource: string;
    decomposable: boolean;
    composition?: EmailComposition;
    reason?: string;
  }> {
    this.assertDev();
    if (!isValidEmailTemplateSlug(name)) {
      throw new BadRequestException(`invalid template name: ${name}`);
    }
    if (locale !== undefined && locale !== "" && !isValidEmailTemplateLocale(locale)) {
      throw new BadRequestException(`invalid locale: ${locale}`);
    }
    const discovered = await discoverReactEmailTemplates();
    // Resolve via runtime precedence: module > core, locale > default.
    const localeKey = locale && locale !== "" ? locale : null;
    const resolutionOrder: Array<{ source: "core" | "module"; locale: string | null }> = [
      { source: "module", locale: localeKey },
      { source: "core", locale: localeKey },
    ];
    if (localeKey !== null) {
      // Fall through to the locale-less default if the requested
      // locale is missing on either side — same behaviour as the
      // ReactEmailTemplateRenderer.
      resolutionOrder.push({ source: "module", locale: null }, { source: "core", locale: null });
    }
    let pick: {
      name: string;
      locale: string | null;
      file: string;
      source: "core" | "module";
    } | null = null;
    for (const step of resolutionOrder) {
      const match = discovered.find(
        (t) => t.name === name && t.locale === step.locale && t.source === step.source,
      );
      if (match) {
        pick = match;
        break;
      }
    }
    if (!pick) throw new NotFoundException();
    const rawSource = await readFile(pick.file, "utf8");
    const result = decomposeTemplateSource(rawSource);
    if (result.decomposable) {
      return {
        name: pick.name,
        locale: pick.locale,
        source: pick.source,
        file: pick.file,
        rawSource,
        decomposable: true,
        composition: result.composition,
      };
    }
    return {
      name: pick.name,
      locale: pick.locale,
      source: pick.source,
      file: pick.file,
      rawSource,
      decomposable: false,
      reason: result.reason,
    };
  }

  /**
   * `DELETE /hub/email-builder/templates/:name/override` — remove a
   * module-overlay copy of a template so the core file becomes
   * authoritative again. Issue #49 ("Reset to default").
   *
   * Defense-in-depth: same path-validation as the save endpoint —
   * `resolveEmailTemplateTarget` rejects bad slugs / locales and
   * the runner double-checks the resolved path is inside the
   * `src/modules/email/templates/` root before unlinking. The core
   * file is unreachable from this code path.
   *
   * 404 when no override exists (no work to do); 200 acted=true
   * after a successful unlink.
   */
  @Delete("email-builder/templates/:name/override")
  @HttpCode(200)
  async emailBuilderDeleteOverride(
    @Param("name") name: string,
    @Query("locale") locale: string | undefined,
  ): Promise<{ ok: true; acted: true; relativePath: string }> {
    this.assertDev();
    if (!isValidEmailTemplateSlug(name)) {
      throw new BadRequestException(`invalid template name: ${name}`);
    }
    const localeArg = locale && locale !== "" ? locale : undefined;
    if (localeArg !== undefined && !isValidEmailTemplateLocale(localeArg)) {
      throw new BadRequestException(`invalid locale: ${localeArg}`);
    }
    const target = resolveEmailTemplateTarget({
      projectRoot: process.cwd(),
      slug: name,
      ...(localeArg !== undefined ? { locale: localeArg } : {}),
    });
    if (!target.ok) throw new BadRequestException(target.error);
    // Belt-and-braces — runner-side anchor check, mirrors the save
    // endpoint. Catches anything that slipped past the planner.
    const expectedPrefix = resolve(process.cwd(), "src/modules/email/templates") + "/";
    if (!target.absolutePath.startsWith(expectedPrefix)) {
      throw new BadRequestException("resolved path escapes module-templates root");
    }
    if (!existsSync(target.absolutePath)) {
      // No override file — nothing to reset. 404 keeps the endpoint
      // semantically honest (idempotent DELETE would still need to
      // signal "did anything happen?" to the UI).
      throw new NotFoundException();
    }
    await rm(target.absolutePath);
    return { ok: true, acted: true, relativePath: target.relativePath };
  }

  /**
   * `/hub/email-builder/blocks.json` — block library + props schema +
   * available layouts. The composer reads this to render the
   * properties panel without a per-block code change.
   */
  @Get("email-builder/blocks.json")
  emailBuilderBlocksJson(): {
    blocks: Array<{
      type: string;
      label: string;
      description: string;
      props: Array<{
        name: string;
        kind: "text" | "url";
        required: boolean;
        supportsVariables: boolean;
      }>;
    }>;
    layouts: Array<{ name: string; description: string }>;
  } {
    this.assertDev();
    return {
      blocks: KNOWN_EMAIL_BLOCKS.map((type) => buildBlockDescriptor(type)),
      layouts: KNOWN_EMAIL_LAYOUTS.map((name) => ({
        name,
        description:
          name === "Barebone" ? "Default frame: brand header, container, body, footer." : "",
      })),
    };
  }

  /**
   * `/hub/email-builder/preview.json` — render a draft composition to
   * HTML+text+subject. No filesystem write; the saved-template path
   * is `POST /hub/email-builder/save`.
   */
  @Post("email-builder/preview.json")
  @HttpCode(200)
  async emailBuilderPreview(@Body() body: unknown): Promise<{
    subject: string;
    html: string;
    text: string;
  }> {
    this.assertDev();
    const composition = pickComposition(body);
    const validation = validateEmailComposition(composition);
    if (!validation.ok) throw new BadRequestException(validation.error);
    const vars = pickVars(body);
    const result = await renderEmailComposition({
      composition,
      vars,
      brand: resolveBrandConfig(),
    });
    return result;
  }

  /**
   * `/hub/email-builder/save` — codegen a composition into a `.tsx`
   * file under `src/modules/email/templates/`. Defense-in-depth path
   * validation: `resolveEmailTemplateTarget` rejects bad slugs and
   * traversal; the runner double-checks the resolved path is inside
   * the module-templates root before writing.
   */
  @Post("email-builder/save")
  @HttpCode(200)
  async emailBuilderSave(@Body() body: unknown): Promise<{
    relativePath: string;
    bytesWritten: number;
  }> {
    this.assertDev();
    const slug = pickSlug(body);
    const locale = pickLocale(body);
    const composition = pickComposition(body);
    const validation = validateEmailComposition(composition);
    if (!validation.ok) throw new BadRequestException(validation.error);
    const target = resolveEmailTemplateTarget({
      projectRoot: process.cwd(),
      slug,
      locale,
    });
    if (!target.ok) throw new BadRequestException(target.error);
    // Belt-and-braces — runner-side anchor check. Catches anything that
    // slipped past the planner (edge case: planner accepted, but the
    // realpath of `process.cwd()` resolves elsewhere).
    const expectedPrefix = resolve(process.cwd(), "src/modules/email/templates") + "/";
    if (!target.absolutePath.startsWith(expectedPrefix)) {
      throw new BadRequestException("resolved path escapes module-templates root");
    }
    const source = composeEmailTemplateSource({ slug, composition });
    await mkdir(dirname(target.absolutePath), { recursive: true });
    await writeFile(target.absolutePath, source, "utf8");
    return {
      relativePath: target.relativePath,
      bytesWritten: Buffer.byteLength(source, "utf8"),
    };
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

  // -----------------------------------------------------------------
  // /dev/migrations · Issue #10 — Migration Handler
  // -----------------------------------------------------------------

  /** SPA shell for `/hub/migrations` — React decides which tab to show. */
  @Get("migrations")
  @Header("content-type", "text/html; charset=utf-8")
  migrationsPage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Migrations" }));
  }

  /** JSON snapshot of applied + pending + failed migrations + drift signal. */
  @Get("migrations.json")
  async migrationsJson(): Promise<unknown> {
    this.assertDev();
    return this.migrations.getStatus();
  }

  /** Read-only SQL preview of a single migration folder. */
  @Get("migrations/preview/:name")
  migrationsPreview(@Param("name") name: string): { name: string; sql: string } {
    this.assertDev();
    try {
      return this.migrations.previewSql(name);
    } catch (err) {
      throw new BadRequestException(asMessage(err));
    }
  }

  /** Schema diff between live DB and `prisma/schema.prisma`. */
  @Get("migrations/diff")
  async migrationsDiff(): Promise<{ sql: string; success: boolean; stderr: string }> {
    this.assertDev();
    return this.migrations.getDiff();
  }

  /** Apply every pending migration. Lock-gated; 409 on contention. */
  @Post("migrations/deploy")
  @HttpCode(200)
  async migrationsDeploy(): Promise<unknown> {
    this.assertDev();
    const r = await this.migrations.deployPending();
    return this.unwrapLock(r);
  }

  /** Apply a single pending migration. */
  @Post("migrations/apply-one")
  @HttpCode(200)
  async migrationsApplyOne(@Body() body: { name?: unknown }): Promise<unknown> {
    this.assertDev();
    const name = assertNonEmptyString(body?.name, "name");
    try {
      const r = await this.migrations.applyOne(name);
      return this.unwrapLock(r);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(asMessage(err));
    }
  }

  /** Run a migration in a transaction + rollback. Non-destructive. */
  @Post("migrations/dry-run")
  @HttpCode(200)
  async migrationsDryRun(@Body() body: { name?: unknown }): Promise<unknown> {
    this.assertDev();
    const name = assertNonEmptyString(body?.name, "name");
    try {
      const r = await this.migrations.dryRun(name);
      return this.unwrapLock(r);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(asMessage(err));
    }
  }

  /** Resolve a failed migration as rolled-back, then retry. */
  @Post("migrations/retry")
  @HttpCode(200)
  async migrationsRetry(@Body() body: { name?: unknown }): Promise<unknown> {
    this.assertDev();
    const name = assertNonEmptyString(body?.name, "name");
    try {
      const r = await this.migrations.retryFailed(name);
      return this.unwrapLock(r);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(asMessage(err));
    }
  }

  /** Generate a new draft migration (does not apply). */
  @Post("migrations/create")
  @HttpCode(200)
  async migrationsCreate(@Body() body: { name?: unknown }): Promise<unknown> {
    this.assertDev();
    const name = assertNonEmptyString(body?.name, "name");
    try {
      const r = await this.migrations.createDraft(name);
      return this.unwrapLock(r);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(asMessage(err));
    }
  }

  /** Apply a previously-created draft migration. */
  @Post("migrations/apply-draft")
  @HttpCode(200)
  async migrationsApplyDraft(@Body() body: { name?: unknown }): Promise<unknown> {
    this.assertDev();
    const name = assertNonEmptyString(body?.name, "name");
    try {
      const r = await this.migrations.applyDraft(name);
      return this.unwrapLock(r);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(asMessage(err));
    }
  }

  /** Discard a draft migration directory. */
  @Delete("migrations/draft/:name")
  @HttpCode(200)
  async migrationsDiscardDraft(
    @Param("name") name: string,
  ): Promise<{ name: string; deleted: boolean }> {
    this.assertDev();
    try {
      return this.migrations.discardDraft(name);
    } catch (err) {
      throw new BadRequestException(asMessage(err));
    }
  }

  private unwrapLock<T>(r: { acquired: boolean; result?: T }): T {
    if (!r.acquired) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: "Conflict",
        message: "another migration is running",
      });
    }
    return r.result as T;
  }

  /**
   * `/hub/jobs` — Jobs-Dashboard SPA shell. Same SPA bundle as the
   * rest of `/hub/*`; react-router resolves to `JobsPage`.
   */
  @Get("jobs")
  @Header("content-type", "text/html; charset=utf-8")
  jobsPage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Jobs" }));
  }

  /**
   * `/hub/jobs/queues.json` — aggregate snapshot for the Queues tab.
   * Per-queue counts + p95 latency + failure rate are computed by the
   * pure planner (`buildJobAggregates`); this endpoint is just the
   * thin runner that hands the queue's history to it.
   */
  @Get("jobs/queues.json")
  jobsQueuesJson() {
    this.assertDev();
    return this.jobs.getAggregates();
  }

  /**
   * `/hub/jobs/jobs.json` — paginated, filterable job listing for the
   * Jobs tab. The in-memory adapter caps `limit` at 500 to keep the
   * response sized for the React table; the React page asks for
   * 100 per page.
   */
  @Get("jobs/jobs.json")
  jobsListJson(
    @Query("state") state: string | undefined,
    @Query("name") name: string | undefined,
    @Query("limit") limit: string | undefined,
  ) {
    this.assertDev();
    const options: ListJobsOptions = {};
    if (state) {
      if (!isJobState(state)) {
        throw new BadRequestException(`unknown state: ${state}`);
      }
      options.state = state;
    }
    if (name) {
      if (!isSafeQueueName(name)) {
        throw new BadRequestException(`invalid queue name`);
      }
      options.name = name;
    }
    if (limit) {
      const parsed = Number.parseInt(limit, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new BadRequestException(`invalid limit`);
      }
      options.limit = Math.min(parsed, 500);
    } else {
      options.limit = 100;
    }
    return { jobs: this.jobs.listJobs(options) };
  }

  /**
   * `/hub/jobs/jobs/:id.json` — full record for the drawer detail view.
   * Validates the id shape before the lookup so a malformed path-param
   * surfaces as a clean 400 instead of leaking through to the
   * Map-lookup path.
   */
  @Get("jobs/jobs/:id.json")
  jobDetailJson(@Param("id") id: string) {
    this.assertDev();
    if (!isSafeJobId(id)) {
      throw new BadRequestException(`invalid job id`);
    }
    const record = this.jobs.getJob(id);
    if (!record) throw new NotFoundException();
    return record;
  }

  /**
   * `POST /hub/jobs/jobs/:id/retry` — re-enqueue a failed job. Returns
   * `{ id }` of the new attempt; the original record stays in history.
   * 404 on unknown ids, 409 on jobs that are not in the failed state.
   */
  @Post("jobs/jobs/:id/retry")
  @HttpCode(200)
  async retryJob(@Param("id") id: string): Promise<{ id: string }> {
    this.assertDev();
    if (!isSafeJobId(id)) {
      throw new BadRequestException(`invalid job id`);
    }
    try {
      const newId = await this.jobs.retry(id);
      return { id: newId };
    } catch (error) {
      if (error instanceof JobNotFoundError) throw new NotFoundException();
      if (error instanceof JobNotRetryableError) throw new ConflictException(error.message);
      throw error;
    }
  }

  /**
   * `/hub/outbox.json` — snapshot of the email-outbox subsystem
   * (issue #11). Returns lag classification + the most recent
   * records (capped at 100) so operators can spot stuck mails. The
   * JSON is the only surface; visibility happens via the existing
   * Jobs Dashboard (the worker tick aggregates as a job entry).
   */
  /**
   * `/hub/email-outbox` — SPA HTML shell for the email-outbox
   * dashboard (issue #11). The React page consumes the existing
   * `/hub/outbox.json` payload — the controller stays a single
   * source of data for both the legacy JSON-only consumer and the
   * new SPA page.
   */
  @Get("email-outbox")
  @Header("content-type", "text/html; charset=utf-8")
  emailOutboxPage(): string {
    this.assertDev();
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Email Outbox", brand: "central" }),
    );
  }

  /**
   * `/hub/cron` — SPA HTML shell for the cron-schedule dashboard
   * (CF.JOBS.02). The React page reads the existing
   * `/hub/scheduled-jobs.json` payload and renders the registry's
   * inventory: every `@ScheduledJob`-decorated method, its cron
   * expression, and the source class.method.
   */
  @Get("cron")
  @Header("content-type", "text/html; charset=utf-8")
  cronPage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Cron", brand: "central" }));
  }

  @Get("outbox.json")
  async outboxJson() {
    this.assertDev();
    if (!this.emailOutbox) {
      return {
        enabled: false,
        message: "email-outbox storage not wired (EmailOutboxModule absent)",
      };
    }
    const now = new Date();
    const [pendingCount, oldestAgeMs] = await Promise.all([
      this.emailOutbox.countPending(),
      this.emailOutbox.oldestPendingAge(now),
    ]);
    const lag = classifyEmailOutboxLag({ pendingCount, oldestAgeMs });
    const dispatchable = await this.emailOutbox.listDispatchable(now, 100);
    return {
      enabled: true,
      health: lag,
      dispatchable: dispatchable.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        attemptCount: r.attemptCount,
        nextAttemptAt: r.nextAttemptAt,
        lastError: r.lastError,
        idempotencyKey: r.idempotencyKey,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * `GET /hub/palette/search.json?q=<query>` — fuzzy page search for
   * the Cmd+K command palette (Issue #90). Returns matching Hub pages
   * ranked by score (exact > prefix > substring > fuzzy). Marked
   * `@Public` because the dev-portal itself runs without auth and this
   * endpoint is gated by `assertDev()` — it 404s in production.
   */
  @Get("palette/search.json")
  @Public(
    "Dev-Hub palette search — fuzzy page lookup for Cmd+K. Dev portal only; assertDev() guards production.",
  )
  paletteSearchJson(@Query("q") q: string | undefined): { pages: PaletteSearchResult[] } {
    this.assertDev();
    const query = typeof q === "string" ? q.trim() : "";
    const pages = buildHubPageCatalog();
    const results = searchPalettePages({ query, pages, maxResults: 30 });
    return { pages: results };
  }

  /**
   * Catch-all for `/hub/*` paths that don't match a more specific
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
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Dev Portal", brand: "central" }),
    );
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

/**
 * Build 24 h × 12 buckets/h = 288 zero-filled request buckets.
 * Used as a stub until a request-log aggregator is implemented.
 */
function buildZeroFilledRequestBuckets(): Array<{
  time: string;
  ok: number;
  err4xx: number;
  err5xx: number;
}> {
  const now = Date.now();
  const buckets: Array<{ time: string; ok: number; err4xx: number; err5xx: number }> = [];
  // 24 h in 5-min buckets = 288 entries; iterate newest-last so charts
  // render left → right in chronological order.
  for (let i = 287; i >= 0; i--) {
    const ts = new Date(now - i * 5 * 60 * 1000);
    buckets.push({
      time: ts.toISOString().slice(11, 16), // "HH:MM"
      ok: 0,
      err4xx: 0,
      err5xx: 0,
    });
  }
  return buckets;
}

/**
 * Build 24 zero-filled hourly session buckets.
 * Used as a stub until the session aggregator is implemented.
 */
function buildZeroFilledSessionBuckets(): Array<{
  hour: string;
  active: number;
  newLogins: number;
}> {
  const now = Date.now();
  const buckets: Array<{ hour: string; active: number; newLogins: number }> = [];
  for (let i = 23; i >= 0; i--) {
    const ts = new Date(now - i * 60 * 60 * 1000);
    buckets.push({
      hour: ts.toISOString().slice(11, 13) + ":00", // "HH:00"
      active: 0,
      newLogins: 0,
    });
  }
  return buckets;
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
 * Whitelist filenames that the `/hub/static/*` handler is allowed to
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

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestException(`body.${fieldName} must be a non-empty string`);
  }
  return value;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const JOB_STATES = new Set<JobState>([
  "created",
  "active",
  "completed",
  "failed",
  "cancelled",
  "retry",
]);

function isJobState(value: string): value is JobState {
  return JOB_STATES.has(value as JobState);
}

/**
 * Allow-list for job ids — UUID-shaped + a defensive length cap.
 * Path-traversal-shaped or otherwise weird ids never reach the lookup.
 */
function isSafeJobId(value: string): boolean {
  if (!value || value.length > 64) return false;
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

/**
 * Allow-list for queue names — slug-shaped, ≤ 64 chars. Mirrors the
 * id check; the in-memory queue accepts any string for `register()`,
 * but the public surface only exposes ones that match this pattern.
 */
function isSafeQueueName(value: string): boolean {
  if (!value || value.length > 64) return false;
  return /^[a-zA-Z0-9._-]+$/.test(value);
}

/**
 * Static catalog of all Hub pages known to the SPA router.
 * Mirrors `nav.ts` + `App.tsx` so the palette can search them without
 * importing React modules on the server side.
 */
function buildHubPageCatalog(): readonly PalettePageEntry[] {
  return [
    {
      id: "dev-hub",
      title: "Dev Hub",
      href: "/hub",
      aliases: ["home", "landing"],
      category: "Übersicht",
    },
    {
      id: "diagnostics",
      title: "Diagnostics",
      href: "/hub/diagnostics",
      aliases: ["health", "memory", "runtime"],
      category: "Übersicht",
    },
    {
      id: "features",
      title: "Features",
      href: "/hub/features",
      aliases: ["flags", "toggles", "feature-flags"],
      category: "Übersicht",
    },
    {
      id: "brand",
      title: "Brand",
      href: "/hub/brand",
      aliases: ["logo", "theme", "colors"],
      category: "Übersicht",
    },
    {
      id: "coverage",
      title: "Coverage",
      href: "/hub/coverage",
      aliases: ["test-coverage", "code-coverage"],
      category: "Übersicht",
    },
    {
      id: "tests",
      title: "Tests",
      href: "/hub/tests",
      aliases: ["test-results", "vitest"],
      category: "Übersicht",
    },
    {
      id: "logs",
      title: "Logs",
      href: "/hub/logs",
      aliases: ["Protokolle", "logging", "log-buffer"],
      category: "Übersicht",
    },
    {
      id: "traces",
      title: "Traces",
      href: "/hub/traces",
      aliases: ["tracing", "spans", "opentelemetry"],
      category: "Übersicht",
    },
    {
      id: "queries",
      title: "Queries",
      href: "/hub/queries",
      aliases: ["sql", "prisma-queries", "database-queries"],
      category: "Übersicht",
    },
    {
      id: "migrations",
      title: "Migrations",
      href: "/hub/migrations",
      aliases: ["schema", "migrate", "database-migrations"],
      category: "Übersicht",
    },
    {
      id: "jobs",
      title: "Jobs",
      href: "/hub/jobs",
      aliases: ["queue", "workers", "background-jobs"],
      category: "Übersicht",
    },
    {
      id: "cron",
      title: "Cron",
      href: "/hub/cron",
      aliases: ["scheduled-jobs", "schedule", "cron-jobs"],
      category: "Übersicht",
    },
    {
      id: "email-outbox",
      title: "Email Outbox",
      href: "/hub/email-outbox",
      aliases: ["outbox", "email-queue"],
      category: "Übersicht",
    },
    {
      id: "files",
      title: "File Manager",
      href: "/hub/files",
      aliases: ["uploads", "assets", "tus"],
      category: "Übersicht",
    },
    {
      id: "scalar",
      title: "API Reference",
      href: "/api/docs",
      aliases: ["scalar", "swagger", "openapi-ui"],
      category: "API & Docs",
    },
    {
      id: "openapi",
      title: "OpenAPI Spec",
      href: "/api/openapi",
      aliases: ["openapi-json", "spec"],
      category: "API & Docs",
    },
    {
      id: "routes",
      title: "Routes",
      href: "/hub/routes",
      aliases: ["endpoints", "http-routes", "route-inventory"],
      category: "API & Docs",
    },
    {
      id: "errors",
      title: "Error Codes",
      href: "/errors",
      aliases: ["error-registry", "error-catalog"],
      category: "API & Docs",
    },
    {
      id: "erd",
      title: "ERD",
      href: "/hub/erd",
      aliases: ["entity-relation", "schema-diagram", "database-diagram"],
      category: "API & Docs",
    },
    {
      id: "email-preview",
      title: "Email Preview",
      href: "/hub/email-preview",
      aliases: ["email-templates", "mail-preview"],
      category: "API & Docs",
    },
    {
      id: "email-builder",
      title: "Email Builder",
      href: "/hub/email-builder",
      aliases: ["email-composer", "template-builder"],
      category: "API & Docs",
    },
    {
      id: "json",
      title: "JSON Viewer",
      href: "/hub/json",
      aliases: ["json-inspector", "json-explorer"],
      category: "API & Docs",
    },
    {
      id: "postgrest-parse",
      title: "PostgREST Parser",
      href: "/hub/postgrest-parse",
      aliases: ["postgrest", "query-parser"],
      category: "API & Docs",
    },
    {
      id: "components",
      title: "Component Showcase",
      href: "/hub/components",
      aliases: ["ui-components", "design-system"],
      category: "API & Docs",
    },
    {
      id: "roles",
      title: "Roles",
      href: "/admin/roles",
      aliases: ["role-management", "rbac"],
      category: "Admin",
    },
    {
      id: "policies",
      title: "Policies",
      href: "/admin/policies",
      aliases: ["policy-management", "casl-policies"],
      category: "Admin",
    },
    {
      id: "permissions-crud",
      title: "Permissions",
      href: "/admin/permissions",
      aliases: ["permission-management", "grants"],
      category: "Admin",
    },
    {
      id: "permissions",
      title: "Permission Tester",
      href: "/admin/permissions/test",
      aliases: ["casl", "test-permissions", "ability-tester"],
      category: "Admin",
    },
    {
      id: "sessions",
      title: "Sessions",
      href: "/admin/sessions",
      aliases: ["active-sessions", "user-sessions"],
      category: "Admin",
    },
    {
      id: "admin-jobs",
      title: "Jobs (Admin)",
      href: "/admin/jobs",
      aliases: ["admin-queue", "admin-jobs"],
      category: "Admin",
    },
    {
      id: "webhooks",
      title: "Webhook Inspector",
      href: "/admin/webhooks",
      aliases: ["webhook-events", "webhooks"],
      category: "Admin",
    },
    {
      id: "realtime",
      title: "Realtime Inspector",
      href: "/admin/realtime",
      aliases: ["websocket", "socket-io", "realtime"],
      category: "Admin",
    },
    {
      id: "audit",
      title: "Audit Browser",
      href: "/admin/audit",
      aliases: ["audit-log", "activity-log"],
      category: "Admin",
    },
    {
      id: "search",
      title: "Search Tester",
      href: "/admin/search",
      aliases: ["fulltext-search", "postgres-search", "fts"],
      category: "Admin",
    },
  ];
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

/**
 * Block-descriptor metadata for the `/hub/email-builder/blocks.json`
 * endpoint. Hand-rolled — the typed JSX components (`Greeting`,
 * `Paragraph`, etc.) accept `children`, but the composer needs
 * named, scalar `props` so the editor can render text inputs without
 * special-casing per block. The mapping doesn't change at runtime;
 * keeping it in the controller keeps the dependency graph tight.
 */
function buildBlockDescriptor(type: string): {
  type: string;
  label: string;
  description: string;
  props: Array<{
    name: string;
    kind: "text" | "url";
    required: boolean;
    supportsVariables: boolean;
  }>;
} {
  switch (type) {
    case "greeting":
      return {
        type,
        label: "Greeting",
        description: "Bold opening line — Hello {{recipientName}},",
        props: [{ name: "text", kind: "text", required: true, supportsVariables: true }],
      };
    case "paragraph":
      return {
        type,
        label: "Paragraph",
        description: "Body paragraph — supports {{var}} interpolation.",
        props: [{ name: "text", kind: "text", required: true, supportsVariables: true }],
      };
    case "cta":
      return {
        type,
        label: "Call-to-Action",
        description: "Primary brand-colored button with a fallback URL paragraph.",
        props: [
          { name: "text", kind: "text", required: true, supportsVariables: true },
          { name: "href", kind: "url", required: true, supportsVariables: true },
        ],
      };
    case "footer":
      return {
        type,
        label: "Footer",
        description: "Body-level small print under a thin divider.",
        props: [{ name: "text", kind: "text", required: true, supportsVariables: true }],
      };
    case "code":
      return {
        type,
        label: "Code / OTP",
        description: "Monospace, brand-tinted block for one-time codes.",
        props: [{ name: "text", kind: "text", required: true, supportsVariables: true }],
      };
    case "divider":
      return {
        type,
        label: "Divider",
        description: "Thin horizontal rule between content sections.",
        props: [],
      };
    default:
      return { type, label: type, description: "", props: [] };
  }
}

function pickComposition(body: unknown): EmailComposition {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("body must be a JSON object");
  }
  const composition = (body as { composition?: unknown }).composition;
  if (!composition || typeof composition !== "object") {
    throw new BadRequestException("body.composition must be an object");
  }
  const c = composition as Record<string, unknown>;
  if (typeof c.layout !== "string") {
    throw new BadRequestException("body.composition.layout must be a string");
  }
  if (typeof c.subject !== "string") {
    throw new BadRequestException("body.composition.subject must be a string");
  }
  if (!Array.isArray(c.children)) {
    throw new BadRequestException("body.composition.children must be an array");
  }
  return composition as EmailComposition;
}

function pickVars(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object") return {};
  const vars = (body as { vars?: unknown }).vars;
  if (!vars || typeof vars !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars as Record<string, unknown>)) {
    out[key] = typeof value === "string" ? value : String(value ?? "");
  }
  return out;
}

function pickSlug(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("body must be a JSON object");
  }
  return assertNonEmptyString((body as { slug?: unknown }).slug, "slug");
}

function pickLocale(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const locale = (body as { locale?: unknown }).locale;
  if (locale === undefined || locale === null || locale === "") return undefined;
  if (typeof locale !== "string") {
    throw new BadRequestException("body.locale must be a string");
  }
  return locale;
}
