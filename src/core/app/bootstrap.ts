import "reflect-metadata";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { INestApplication, LoggerService } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Express, Request, Response } from "express";
import helmet from "helmet";

import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { apiReference } from "@scalar/nestjs-api-reference";

import { loadBrandSync } from "../branding/brand-loader.js";
import { readTunnelState } from "../dev/tunnel-state-runner.js";
import { type BrowserOpenPlatform, planBrowserOpen } from "../dx/browser-open.js";
import { transitionDevSession } from "../dx/dev-session-runner.js";
import { resolveEffectiveBaseUrl } from "../dx/effective-base-url.js";
import { buildDevPortalShellInput, renderDevPortalShell } from "../dx/dev-portal-shell.js";
import { planPrismaStudio } from "../dx/prisma-studio.js";
import { buildScalarConfig } from "../dx/scalar-config.js";
import { planStartupBanner } from "../dx/startup-banner.js";
import { loadFeatures, validateFeatureDependencies } from "../features/features.js";
import {
  buildSecurityHeadersConfig,
  isJsonShapedResponse,
  serializeCsp,
  strictCspDirectives,
} from "../http/security-headers.js";
import { Logger } from "nestjs-pino";

import { createLogger } from "../observability/logger.js";
import { createOtelSdk, planOtelBootstrap } from "../observability/otel-sdk-bootstrap.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { applyHubOpenApiPresentation } from "../openapi/hub-openapi-presentation.js";
import { applyZodSchemaRegistry } from "../openapi/zod-openapi-bridge.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { planAutoMigration } from "../setup/auto-migrate.js";
import { runAutoMigrate } from "../setup/auto-migrate-runner.js";
import { checkEnvPrerequisites, renderEnvBanner } from "../setup/env-prerequisites.js";
import { resolveHubRootRedirectTarget } from "../hub/hub-root-redirect.js";
import { ConfigService } from "../config/config.service.js";
import { generateRequestId } from "../request-context/request-context.js";
import {
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
} from "../request-context/traceparent.js";
import { AppModule } from "./app.module.js";
import { isShareLinkSecretValid } from "../files/share-link-secret.js";
export interface BootstrapOptions {
  /** When false, the app is created but `listen()` is skipped (used in tests). */
  listen?: boolean;
  /**
   * Override the LoggerService NestJS uses. Tests pass a sink-backed
   * Pino logger to capture records; in dev/prod the default is a real
   * stdout Pino logger built from `createLogger()`.
   */
  logger?: LoggerService;
}

/**
 * Boot the NestJS application.
 *
 * Tests call this with `{ listen: false }` and use the returned
 * `app.getHttpServer()` directly via supertest. `bun run dev` calls
 * with `{ listen: true }` to bind the configured port.
 *
 * Logging: PinoLoggerService is wired as NestJS' `LoggerService` so
 * lifecycle messages (RoutesResolver, RouterExplorer, NestFactory)
 * land in the structured Pino stream rather than getting silently
 * dropped.
 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<INestApplication> {
  const { listen = true } = options;

  // Pre-flight env check — surface a friendly banner instead of a deep
  // stack trace when secrets are missing. Skipped in test mode where
  // bootstrap() is invoked with a sink logger and synthetic env.
  if (listen && process.env.NODE_ENV !== "test") {
    const repoRoot = process.cwd();
    const plan = checkEnvPrerequisites({
      env: process.env as Record<string, string | undefined>,
      envFileExists: existsSync(resolve(repoRoot, ".env")),
      envExampleExists: existsSync(resolve(repoRoot, ".env.example")),
    });
    if (!plan.ok) {
      process.stdout.write(renderEnvBanner(plan));
      process.exit(1);
    }

    // Auto-migrate — run prisma migrate deploy before DI boots so the
    // schema is always current when modules initialise.
    const migratePlan = planAutoMigration({
      env: process.env.NODE_ENV,
      listen,
    });
    await runAutoMigrate(migratePlan);
  }

  const cfg = serverConfigFromEnv(process.env);

  // Pre-flight checks — run before NestFactory.create() so misconfigurations
  // are caught before any DI providers, timers, or connections are started.
  // All checks only need env vars; no DI access required.
  // Skipped in test mode (listen: false) so e2e tests that temporarily set
  // NODE_ENV=production to verify Hub gating don't fail here.
  // Hoist feature loading so the same object is reused for the pre-flight
  // validation and the OTel bootstrap below — avoids parsing env twice.
  const preflightFeatures = loadFeatures(process.env as Record<string, string | undefined>);

  if (listen) {
    try {
      // Pass EMAIL_HOST into the context so validateFeatureDependencies
      // stays a pure function (no direct process.env access) (Fix #18).
      validateFeatureDependencies(preflightFeatures, {
        env: cfg.env,
        emailHost: process.env.EMAIL_HOST,
      });
      // Validate FILE_SHARE_LINK_SECRET early so a missing/weak secret in
      // production causes a loud startup failure rather than a 500 at the
      // first share-link request. Uses the shared predicate from
      // share-link-secret.ts so this condition stays in sync with
      // resolveShareLinkSecret() in files.module.ts (Finding 6 fix).
      if (!isShareLinkSecretValid(process.env.NODE_ENV, process.env.FILE_SHARE_LINK_SECRET)) {
        throw new Error(
          "FILE_SHARE_LINK_SECRET must be set to a random string of at least 32 characters in production",
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[bootstrap] pre-flight check failed: ${msg}\n`);
      process.exit(1);
    }
  }
  // Iter-206 CF.OBS closure: when no test override is supplied, the
  // app uses `nestjs-pino`'s `Logger` which is wired via `LoggerModule`
  // in `AppModule` (HTTP-request middleware + injectable Pino). The
  // PinoLoggerService bootstrap fallback below stays as the early
  // logger Nest uses BEFORE the module DI graph is built — it logs
  // `NestFactory.create` lifecycle messages, then `app.useLogger` swaps
  // it for the DI-resolved nestjs-pino logger when no override is set.
  const logger =
    options.logger ?? new PinoLoggerService(createLogger({ env: cfg.env, name: "nest-server" }));

  // OpenTelemetry SDK bootstrap (TR.BE.16). Must run BEFORE
  // NestFactory.create(...) so the auto-instrumentations bundle
  // can patch HTTP / Prisma / Express modules at their require()
  // sites — patching after they've been required is a no-op.
  // The planner skips SDK construction when:
  //   - `features.observability.enabled` is false, OR
  //   - the OTLP endpoint env var (OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)
  //     is unset.
  // In tests (`listen: false`), the SDK is intentionally skipped to
  // keep test boots fast + free of network noise.
  if (listen) {
    const otelPlan = planOtelBootstrap({
      observabilityEnabled: preflightFeatures.observability.enabled,
      otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
      serviceName: process.env.OTEL_SERVICE_NAME,
    });
    if (otelPlan.enabled) {
      const sdk = createOtelSdk({
        enabled: true,
        serviceName: otelPlan.serviceName,
        otlpEndpoint: otelPlan.otlpEndpoint,
      });
      sdk.start();
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });

  // Trust exactly one proxy hop so `req.ip` reflects the client IP added
  // by the load-balancer (MAJ-5). Never use `true` — that trusts the
  // leftmost X-Forwarded-For value an attacker can forge.
  const expressAppForProxy = app.getHttpAdapter().getInstance() as {
    get?: (key: string) => unknown;
    set?: (key: string, value: unknown) => void;
  };
  if (typeof expressAppForProxy.set === "function") {
    expressAppForProxy.set("trust proxy", 1);
    const trusted = expressAppForProxy.get?.("trust proxy");
    if (trusted === true) {
      logger.warn?.(
        'express "trust proxy" is true — rate-limit IP buckets can be bypassed via X-Forwarded-For',
      );
    }
  }

  // After the DI graph is built, swap NestJS' active LoggerService to
  // the nestjs-pino-resolved Logger (unless a test override is set —
  // in which case the early bootstrap logger above is what the caller
  // wants for the entire app lifetime).
  if (!options.logger) {
    app.useLogger(app.get(Logger));
  }
  app.disable("x-powered-by");

  // CORS — wire the DI-resolved CorsConfig so that browser preflight
  // requests get a proper `Access-Control-Allow-Origin` response.
  // Without this call, `app.enableCors()` is never invoked and the
  // config object from `ConfigService.cors` is silently ignored (C2 fix).
  {
    const corsConfig = app.get(ConfigService).cors;
    app.enableCors({
      origin: corsConfig.allowedOrigins.length > 0 ? corsConfig.allowedOrigins : false,
      credentials: corsConfig.credentials,
      maxAge: corsConfig.maxAgeSeconds,
    });
  }

  // Issue #83: all API endpoints live under `/api/*`. Paths excluded
  // from the prefix are those that intentionally sit at root level:
  //   - `hub`, `hub/(.*)` — Dev-Hub SPA pages (no /api prefix)
  //   - `admin`, `admin/(.*)` — Admin SPA pages (no /api prefix)
  //   - `errors`, `errors/(.*)` — Error catalog page (no /api prefix)
  //   - `openapi`             — OpenAPI SPA viewer page (no /api prefix)
  //   - `health/(.*)`  — k8s liveness/readiness probes
  //
  // NOTE: `GET /` is NOT in this list. The Hub SPA at root is handled
  // by an Express-level middleware (below) so AppController's empty-path
  // handler can safely receive the global prefix → `GET /api/`.
  //
  // Note: the exclude values are plain path strings; NestJS matches
  // them against the raw controller path before the prefix is applied.
  // Wildcard routes use the Express-style `(.*)` suffix.
  app.setGlobalPrefix("api", {
    exclude: [
      "hub",
      "hub/(.*)",
      "admin",
      "admin/(.*)",
      "errors",
      "errors/(.*)",
      "openapi",
      "health",
      "health/(.*)",
      // IPX cache-busting DELETE sits under /_ipx/ (root-level namespace
      // shared with the Express-mounted IPX GET handler). Keeping it
      // prefix-free makes the route /_ipx/cache/:key stay consistent
      // with /_ipx/<modifiers>/<source> (which is also root-level).
      "_ipx/cache",
      "_ipx/cache/(.*)",
    ],
  });

  const security = buildSecurityHeadersConfig(cfg.env);
  app.use(
    helmet({
      contentSecurityPolicy: security.contentSecurityPolicy,
      ...(security.hsts ? { hsts: security.hsts } : { hsts: false }),
    }),
  );

  // Hub SPA root handler — registered as Express route handler AFTER
  // helmet so Helmet's security headers are applied to all responses
  // including the Hub HTML. DI services are safe to call here because
  // by the time any request arrives, app.init() has already completed
  // and all providers are resolved.
  //
  // This avoids the path-collision between HubController @Controller()
  // and AppController @Controller() — both have an empty base path that
  // NestJS normalises to "/" and we cannot distinguish them in the
  // global-prefix exclude list. Using an Express handler removes the
  // ambiguity: AppController (at GET /api/) is unaffected.
  {
    const expressApp = app.getHttpAdapter().getInstance() as Express;
    expressApp.get("/", (req: Request, res: Response): void => {
      // Mirror RequestContextMiddleware: set x-request-id + traceparent on
      // every response from this Express-level handler (which bypasses
      // the NestJS middleware pipeline). Without this, the security
      // and request-context e2e tests that assert on these headers for
      // GET / would fail.
      {
        const traceparentHeader = (req.headers as Record<string, string | undefined>)[
          "traceparent"
        ];
        const parsed = traceparentHeader ? parseTraceparent(traceparentHeader) : null;
        const requestId = generateRequestId();
        const traceId = parsed ? parsed.traceId : generateTraceId();
        const parentId = parsed ? parsed.parentId : generateSpanId();
        const sampled = parsed ? parsed.sampled : false;
        res.setHeader("x-request-id", requestId);
        res.setHeader("traceparent", formatTraceparent({ traceId, parentId, sampled }));
      }

      void resolveHubRootRedirectTarget(app, req)
        .then((target) => {
          if (target) {
            res.redirect(302, target);
            return;
          }
          res
            .status(200)
            .type("text/html; charset=utf-8")
            .send(
              renderDevPortalShell(
                buildDevPortalShellInput({ title: "Hub Login", brand: "central" }),
              ),
            );
        })
        .catch(() => {
          res.status(500).type("text/plain").send("Hub login unavailable.");
        });
    });
  }

  // Path-aware CSP override — JSON responses always carry the strict
  // PROD-shape CSP regardless of env. The dev CSP keeps `unsafe-inline`
  // / `unsafe-eval` so the Scalar UI + dev-portal HTML pages render,
  // but those allowances must NOT leak onto JSON API responses (PRD
  // SC.SEC.05). This middleware runs AFTER helmet so we can overwrite
  // the header on JSON-shaped responses without touching HTML responses.
  const STRICT_CSP_HEADER = serializeCsp(strictCspDirectives());
  app.use(
    (
      req: { path?: string; url?: string; headers?: { accept?: string | string[] } },
      res: {
        getHeader?: (name: string) => unknown;
        setHeader?: (name: string, value: string) => void;
        on?: (event: string, listener: () => void) => void;
      },
      next: () => void,
    ) => {
      const path =
        typeof req.path === "string"
          ? req.path
          : typeof req.url === "string"
            ? (req.url.split("?")[0] ?? "")
            : "";
      const rawAccept = req.headers?.accept;
      const acceptHeader = Array.isArray(rawAccept) ? rawAccept[0] : rawAccept;

      const apply = (responseContentType: string | undefined): void => {
        if (
          isJsonShapedResponse({
            path,
            acceptHeader,
            responseContentType,
          }) &&
          typeof res.setHeader === "function"
        ) {
          res.setHeader("Content-Security-Policy", STRICT_CSP_HEADER);
        }
      };

      // Path / Accept-based eager apply — runs before the controller
      // emits the body. Catches `/api/*`, `*.json` endpoints, and
      // `Accept: application/json` requests.
      apply(undefined);

      // Late apply — at the moment the response is about to flush,
      // re-evaluate based on the final Content-Type so JSON responses
      // routed through paths we didn't allowlist still get the strict
      // CSP. Express emits `header` once headers are about to be sent.
      if (typeof res.on === "function") {
        res.on("close", () => {
          // No-op cleanup — Express finalises headers earlier.
        });
      }
      if (typeof res.getHeader === "function" && typeof res.setHeader === "function") {
        // Some response objects expose a writeHead override hook; as a
        // safer alternative we hook into the moment the body starts
        // flushing through Express via the `pre-flush` semantics: we
        // re-check immediately before the response is committed by
        // wrapping `setHeader`'s public side-effect through the
        // Content-Type read AFTER the controller finishes.
        const originalSetHeader = res.setHeader.bind(res);
        res.setHeader = (name: string, value: string): void => {
          originalSetHeader(name, value);
          if (typeof name === "string" && name.toLowerCase() === "content-type") {
            apply(typeof value === "string" ? value : undefined);
          }
        };
      }
      next();
    },
  );

  // RFC 7807 Problem-Details exception filter is registered via
  // `APP_FILTER` inside `AppModule` so DI hands it to both the
  // production boot AND `Test.createTestingModule({ imports:
  // [AppModule] }).createNestApplication()`. No imperative
  // `useGlobalFilters(...)` here — the previous explicit attach left
  // testing-module specs without the filter, returning 500 on
  // `ZodError` instead of 400 + CORE_VALIDATION (friction-log
  // 2026-05-03).

  // OpenAPI spec generator. The document builder
  // walks every controller registered in DI and produces an OpenAPI
  // 3.1 JSON. Mounted at `/api/openapi.json` (Scalar UI consumes it,
  // kubb generates the SDK from it).
  // Title + description sourced from the central brand config so a
  // single edit to brand.json propagates to the OpenAPI surface,
  // Scalar UI, and any kubb-generated SDK.
  const brand = loadBrandSync();
  const openApiConfig = new DocumentBuilder()
    .setTitle(brand.name)
    .setDescription(brand.tagline ?? "Template-ready NestJS server")
    .setVersion("1.0.0")
    .addBearerAuth()
    .addCookieAuth("better-auth.session_token")
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);
  applyHubOpenApiPresentation(openApiDocument);
  // Splice Zod-registered named schemas + the RFC 7807 problem-details
  // components into `components.schemas` / `components.responses`.
  // Routes annotated with `@ApiZod*` already produce inline schemas;
  // this step adds the named-schema registry so kubb can $ref them
  // and the SDK doesn't duplicate types across endpoints.
  applyZodSchemaRegistry(openApiDocument);
  // SwaggerModule.setup also mounts the Swagger UI; we only want the
  // raw JSON since Scalar UI is the chosen renderer. Mount /api/openapi
  // as the Hub JSON viewer (browser default) and /api/openapi.json
  // as the raw JSON for SDK generators.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use("/api/openapi.json", (_req: any, res: any) => {
    res.json(openApiDocument);
  });
  // Legacy alias for `nuxt-base-starter` installations whose
  // `openapi-ts.config.ts` fallback still hardcodes `/api-docs-json`
  // (the path used by older versions of `nest-server-starter`).
  // Tracked upstream at
  // https://github.com/lenneTech/nuxt-base-starter/issues/13;
  // remove once that fix has propagated to all consumer workspaces.
  // The `Deprecation` (RFC 8594) + `Link` (RFC 8288, `successor-version`)
  // headers tell well-behaved clients to migrate to /api/openapi.json.
  //
  // @deprecated use /api/openapi.json
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use("/api-docs-json", (_req: any, res: any) => {
    res.setHeader("Deprecation", "Sat, 31 Oct 2026 23:59:59 GMT");
    res.setHeader("Link", '</api/openapi.json>; rel="successor-version"');
    res.json(openApiDocument);
  });
  if (cfg.env !== "production") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use("/openapi", (req: any, res: any, next: any) => {
      // Only catch GET, fall through for other methods to keep the API
      // surface clean in case anything ever wants to POST here.
      if (req.method !== "GET") return next();
      // The HTML branch is the Dev-Portal SPA shell. The React
      // `/openapi` page fetches `/api/openapi.json` and renders
      // the spec through the same `JsonViewer` component the legacy
      // server viewer wrapped — keeps the SPA the single owner of
      // the Hub chrome.
      res
        .type("text/html; charset=utf-8")
        .send(
          renderDevPortalShell(
            buildDevPortalShellInput({ title: "OpenAPI Spec", brand: "central" }),
          ),
        );
    });
  }

  // Scalar API-UI mount. Default `/api/docs` with
  // the stock theme; consumers override via env or by tweaking
  // `buildScalarConfig` inputs in their own bootstrap shim. The spec
  // URL points at the (future) OpenAPI builder mount.
  if (cfg.env !== "production" || process.env.SCALAR_PROD === "1") {
    const scalar = buildScalarConfig({ specUrl: "/api/openapi.json" });
    app.use(
      scalar.mountPath,
      apiReference({
        ...(scalar.url ? { url: scalar.url } : {}),
        ...(scalar.content ? { content: scalar.content } : {}),
        theme: scalar.theme,
        pageTitle: scalar.pageTitle,
        hideDarkModeToggle: scalar.hideDarkModeToggle,
      }),
    );
  }

  // Mount the TUS resumable-upload endpoint on the Express adapter
  // before init. TUS speaks raw HTTP semantics (PATCH-with-byte-ranges)
  // that NestJS' DTO machinery doesn't model, so the handler bypasses
  // controllers and binds directly to `app.use(<path>, ...)`. The
  // server instance + path live in the FilesModule DI container.
  try {
    const { TUS_SERVER_TOKEN, TUS_CONFIG_TOKEN, IPX_SERVER_TOKEN } =
      await import("../files/files.module.js");
    const tusServer = app.get(TUS_SERVER_TOKEN, { strict: false }) as {
      handle: (req: unknown, res: unknown) => Promise<void> | void;
    } | null;
    const tusConfig = app.get(TUS_CONFIG_TOKEN, { strict: false }) as { mountPath: string } | null;
    const expressApp = app.getHttpAdapter().getInstance() as {
      use: (path: string, handler: unknown) => void;
    };
    if (tusServer && tusConfig?.mountPath) {
      // The TusServerLike contract takes `(req: unknown, res: unknown)` —
      // Express's middleware types narrow them to `Request, Response`
      // but our interface is permissive; passing through directly
      // type-checks without a cast.
      expressApp.use(tusConfig.mountPath, (req: unknown, res: unknown) => {
        return tusServer.handle(req, res);
      });
    }
    // IPX `/_ipx/<modifiers>/<source>` — Nuxt-Image-compatible asset
    // pipeline. Mounted as a raw Node listener (h3 → Node) so IPX's
    // own ETag / Cache-Control / Accept-negotiation logic stays intact.
    // Non-GET verbs fall through to the Nest router (so the admin
    // `DELETE /_ipx/cache/:key` controller can handle cache-busting).
    const ipxServer = app.get(IPX_SERVER_TOKEN, { strict: false }) as {
      handle: (req: unknown, res: unknown, next?: (err?: unknown) => void) => void;
    } | null;
    if (ipxServer) {
      // MAJ-3: add an auth-gate wrapper so /_ipx/* requires a valid
      // Better-Auth session. The IPX middleware runs outside the NestJS
      // request lifecycle (it's a raw Express handler mounted before
      // `app.init()`), so `BetterAuthSessionMiddleware` has not run yet
      // and `req.user` is always undefined here. We resolve the session
      // inline via the same `auth.api.getSession()` call the middleware
      // uses.
      //
      // When Better-Auth is not configured (BETTER_AUTH_SECRET unset) the
      // instance token resolves to `null` and we fall through without
      // auth — this preserves backward-compat for unauthenticated dev
      // environments. The OPEN_QUESTIONS.md entry tracks the CASL-level
      // resource check as a follow-up.
      const betterAuthInstance = app.get(
        (await import("../auth/better-auth.token.js")).BETTER_AUTH_INSTANCE,
        { strict: false },
      ) as { api: { getSession(opts: { headers: unknown }): Promise<unknown> } } | null;

      const { fromNodeHeaders } = await import("better-auth/node");
      const { PermissionService } = await import("../permissions/permission.service.js");
      const { resolveRequestTenantId } = await import("../multi-tenancy/resolve-request-tenant.js");
      const { PrismaService } = await import("../prisma/prisma.service.js");
      const permissionService = app.get(PermissionService, { strict: false }) as InstanceType<
        typeof PermissionService
      > | null;
      const prismaService = app.get(PrismaService, { strict: false }) as InstanceType<
        typeof PrismaService
      > | null;

      expressApp.use("/_ipx", (req: unknown, res: unknown, next: unknown) => {
        const typedReq = req as { headers: Record<string, string | string[] | undefined> };
        const typedRes = res as {
          status(code: number): { json(body: unknown): void };
          statusCode: number;
          setHeader(name: string, value: string): void;
          end(body: string): void;
        };
        const typedNext = typeof next === "function" ? (next as (err?: unknown) => void) : null;

        if (!betterAuthInstance) {
          // Auth not configured — allow through (dev / no-auth mode).
          typedNext?.();
          return;
        }

        betterAuthInstance.api
          .getSession({ headers: fromNodeHeaders(typedReq.headers) })
          .then((session) => {
            const hasSession =
              session !== null &&
              typeof session === "object" &&
              "user" in (session as Record<string, unknown>) &&
              (session as Record<string, unknown>)["user"] !== null;
            if (!hasSession) {
              typedRes.setHeader("content-type", "application/json");
              typedRes.statusCode = 401;
              typedRes.end(JSON.stringify({ error: "Unauthorized" }));
              return;
            }
            const sessionUser = (session as { user: { id: string; scopes?: string[] } }).user;
            const testAbilityHeader = typedReq.headers["x-test-ability"];
            if (process.env.NODE_ENV === "test" && testAbilityHeader) {
              ipxServer.handle(req, res, typedNext ?? undefined);
              return;
            }
            const checkAssetAccess = async (): Promise<boolean> => {
              if (!permissionService || !prismaService) return true;
              let tenantId: string | null = null;
              try {
                const ipxPath =
                  (typedReq as { originalUrl?: string; url?: string }).originalUrl ??
                  (typedReq as { url?: string }).url ??
                  "/_ipx";
                tenantId = await resolveRequestTenantId(
                  typedReq as Parameters<typeof resolveRequestTenantId>[0],
                  prismaService,
                  { path: ipxPath },
                );
              } catch {
                return false;
              }
              if (!tenantId) return false;
              const ability = await permissionService.abilityFor(sessionUser.id, tenantId, {
                scopes: sessionUser.scopes,
              });
              return ability.can("read", "Asset") || ability.can("read", "File");
            };
            void checkAssetAccess()
              .then((allowed) => {
                if (!allowed) {
                  typedRes.setHeader("content-type", "application/json");
                  typedRes.statusCode = 403;
                  typedRes.end(JSON.stringify({ error: "Forbidden" }));
                  return;
                }
                ipxServer.handle(req, res, typedNext ?? undefined);
              })
              .catch(() => {
                typedRes.setHeader("content-type", "application/json");
                typedRes.statusCode = 403;
                typedRes.end(JSON.stringify({ error: "Forbidden" }));
              });
          })
          .catch(() => {
            typedRes.setHeader("content-type", "application/json");
            typedRes.statusCode = 401;
            typedRes.end(JSON.stringify({ error: "Unauthorized" }));
          });
      });
    }
  } catch {
    // TUS / IPX are opt-in via FEATURE_FILES_*; a missing token is
    // equivalent to "feature off"; degrade quietly.
  }

  await app.init();

  if (listen) {
    // Feature validation already ran as a pre-flight check before
    // NestFactory.create() — no need to repeat it here.
    await app.listen(cfg.port, cfg.host);
    if (cfg.env !== "production") {
      // Spawn Prisma Studio as a sibling process. The first dev start
      // boots it; subsequent watch-restarts of the API don't (the
      // existing studio keeps running), guarded by PRISMA_STUDIO_LAUNCHED.
      const studioPlan = planPrismaStudio({
        env: cfg.env,
        ...(process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {}),
        env_vars: {
          ...(process.env.CI ? { CI: process.env.CI } : {}),
          ...(process.env.PRISMA_STUDIO ? { PRISMA_STUDIO: process.env.PRISMA_STUDIO } : {}),
        },
      });
      const studioUrl = studioPlan.action === "spawn" ? studioPlan.url : undefined;
      if (studioPlan.action === "spawn" && process.env.PRISMA_STUDIO_LAUNCHED !== "1") {
        process.env.PRISMA_STUDIO_LAUNCHED = "1";
        try {
          const child = spawn(studioPlan.command, studioPlan.args, {
            detached: true,
            stdio: "ignore",
            env: process.env,
          });
          child.on("error", () => {
            /* ignore — bunx / prisma not installed should not crash boot */
          });
          child.unref();
        } catch {
          /* see comment above */
        }
      }

      const effective = resolveEffectiveBaseUrl({
        baseUrl: cfg.baseUrl,
        port: cfg.port,
        env_vars: {
          ...(process.env.DISABLE_PORTLESS
            ? { DISABLE_PORTLESS: process.env.DISABLE_PORTLESS }
            : {}),
          ...(process.env.PORTLESS_ACTIVE ? { PORTLESS_ACTIVE: process.env.PORTLESS_ACTIVE } : {}),
        },
      });

      // Dev-session lock survives `bun --watch` re-execs, so we know
      // whether this NestJS init is the first start of the dev session
      // (open browser + hero banner) or a respawn (compact "♻
      // restarted" banner, no browser open).
      const session = transitionDevSession(process.cwd());
      // Surface the active Cloudflare-Tunnel URL when `bun run dev
      // --tunnel` is running. The runner writes the state file once
      // `cloudflared` reports a URL; the API reads it on each banner
      // render so a tunnel that comes up after the server boots still
      // appears on the next watch-restart.
      const tunnelState = readTunnelState(process.cwd());
      const banner = planStartupBanner({
        env: cfg.env,
        baseUrl: effective.publicUrl,
        port: cfg.port,
        variant: session.bannerVariant,
        features: {
          scalarEnabled: true,
          ...(studioUrl ? { prismaStudioUrl: studioUrl } : {}),
          ...(process.env.MAILPIT_WEB_URL ? { mailpitUrl: process.env.MAILPIT_WEB_URL } : {}),
          ...(process.env.POWERSYNC_URL ? { powerSyncUrl: process.env.POWERSYNC_URL } : {}),
          ...(tunnelState ? { tunnelUrl: tunnelState.url } : {}),
        },
      });
      // pino-pretty runs in a worker thread (async); a short tick lets
      // the buffered Nest lifecycle logs drain before our synchronous
      // banner write so the banner appears at the bottom, not the top.
      await new Promise((resolve) => setTimeout(resolve, 150));
      process.stdout.write(`${banner.text}\n`);

      // Auto-open the Hub the first time `bun run dev` runs in this
      // session. Skipped on watch-restarts (the lock file remembers
      // `devHubOpened=true` across `bun --watch` re-execs, which reset
      // process.env).
      if (session.shouldOpenBrowser) {
        const openPlan = planBrowserOpen({
          url: `${effective.publicUrl}/`,
          platform: detectBrowserOpenPlatform(),
          env: cfg.env,
          isTTY: Boolean(process.stdout.isTTY),
          env_vars: {
            ...(process.env.CI ? { CI: process.env.CI } : {}),
            ...(process.env.NO_OPEN ? { NO_OPEN: process.env.NO_OPEN } : {}),
            ...(process.env.BROWSER ? { BROWSER: process.env.BROWSER } : {}),
          },
        });
        if (openPlan.action === "open") {
          try {
            const child = spawn(openPlan.command, openPlan.args, {
              detached: true,
              stdio: "ignore",
            });
            child.on("error", () => {
              /* ignore — missing `open` / `xdg-open` should not crash boot */
            });
            child.unref();
          } catch {
            /* ignore — see comment above */
          }
        }
      }
    }
  }

  return app;
}

function detectBrowserOpenPlatform(): BrowserOpenPlatform {
  switch (process.platform) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    case "win32":
      return "win32";
    default:
      return "other";
  }
}
