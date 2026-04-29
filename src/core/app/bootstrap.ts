import "reflect-metadata";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { INestApplication, LoggerService } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";

import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { apiReference } from "@scalar/nestjs-api-reference";

import { type BrowserOpenPlatform, planBrowserOpen } from "../dx/browser-open.js";
import { transitionDevSession } from "../dx/dev-session-runner.js";
import { resolveEffectiveBaseUrl } from "../dx/effective-base-url.js";
import { renderJsonViewerPage } from "../dx/json-viewer-ui.js";
import { planPrismaStudio } from "../dx/prisma-studio.js";
import { buildScalarConfig } from "../dx/scalar-config.js";
import { planStartupBanner } from "../dx/startup-banner.js";
import { ProblemDetailsExceptionFilter } from "../errors/problem-details.filter.js";
import { buildSecurityHeadersConfig } from "../http/security-headers.js";
import { createLogger } from "../observability/logger.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { checkEnvPrerequisites, renderEnvBanner } from "../setup/env-prerequisites.js";
import { AppModule } from "./app.module.js";

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
  }

  const cfg = serverConfigFromEnv(process.env);
  const logger =
    options.logger ?? new PinoLoggerService(createLogger({ env: cfg.env, name: "nest-server" }));

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  app.disable("x-powered-by");

  const security = buildSecurityHeadersConfig(cfg.env);
  app.use(
    helmet({
      contentSecurityPolicy: security.contentSecurityPolicy,
      ...(security.hsts ? { hsts: security.hsts } : { hsts: false }),
    }),
  );

  app.useGlobalFilters(new ProblemDetailsExceptionFilter());

  // OpenAPI spec generator (PLAN.md §32 Phase 8). The document builder
  // walks every controller registered in DI and produces an OpenAPI
  // 3.1 JSON. Mounted at `/api/openapi.json` (Scalar UI consumes it,
  // kubb generates the SDK from it).
  const openApiConfig = new DocumentBuilder()
    .setTitle("nest-base")
    .setDescription("Template-fähiger NestJS-Server")
    .setVersion("1.0.0")
    .addBearerAuth()
    .addCookieAuth("better-auth.session_token")
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);
  // SwaggerModule.setup also mounts the Swagger UI; we only want the
  // raw JSON since Scalar UI is the chosen renderer. Mount /api/openapi
  // as the dev-hub JSON viewer (browser default) and /api/openapi.json
  // as the raw JSON for SDK generators.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use("/api/openapi.json", (_req: any, res: any) => {
    res.json(openApiDocument);
  });
  if (cfg.env !== "production") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use("/api/openapi", (req: any, res: any, next: any) => {
      // Only catch GET, fall through for other methods to keep the API
      // surface clean in case anything ever wants to POST here.
      if (req.method !== "GET") return next();
      res.type("text/html; charset=utf-8").send(
        renderJsonViewerPage({
          title: "OpenAPI Spec",
          subtitle: "OpenAPI 3.1 document this server emits — consumed by Scalar UI and kubb.",
          currentNav: "openapi",
          value: openApiDocument,
          rawJsonHref: "/api/openapi.json",
        }),
      );
    });
  }

  // Scalar API-UI mount (PLAN.md §32 Phase 8). Default `/api/docs` with
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

  await app.init();

  if (listen) {
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
        },
      });
      // pino-pretty runs in a worker thread (async); a short tick lets
      // the buffered Nest lifecycle logs drain before our synchronous
      // banner write so the banner appears at the bottom, not the top.
      await new Promise((resolve) => setTimeout(resolve, 150));
      process.stdout.write(`${banner.text}\n`);

      // Auto-open the Dev Hub the first time `bun run dev` runs in this
      // session. Skipped on watch-restarts (the lock file remembers
      // `devHubOpened=true` across `bun --watch` re-execs, which reset
      // process.env).
      if (session.shouldOpenBrowser) {
        const openPlan = planBrowserOpen({
          url: `${effective.publicUrl}/dev`,
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
