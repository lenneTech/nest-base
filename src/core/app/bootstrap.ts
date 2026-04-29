import 'reflect-metadata';

import type { INestApplication, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { apiReference } from '@scalar/nestjs-api-reference';

import { buildScalarConfig } from '../dx/scalar-config.js';
import { ProblemDetailsExceptionFilter } from '../errors/problem-details.filter.js';
import { buildSecurityHeadersConfig } from '../http/security-headers.js';
import { createLogger } from '../observability/logger.js';
import { PinoLoggerService } from '../observability/pino-logger.service.js';
import { serverConfigFromEnv } from '../server/server-config.js';
import { AppModule } from './app.module.js';

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

  const cfg = serverConfigFromEnv(process.env);
  const logger =
    options.logger ??
    new PinoLoggerService(createLogger({ env: cfg.env, name: 'nest-server' }));

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  app.disable('x-powered-by');

  const security = buildSecurityHeadersConfig(cfg.env);
  app.use(
    helmet({
      contentSecurityPolicy: security.contentSecurityPolicy,
      ...(security.hsts ? { hsts: security.hsts } : { hsts: false }),
    }),
  );

  app.useGlobalFilters(new ProblemDetailsExceptionFilter());

  // Scalar API-UI mount (PLAN.md §32 Phase 8). Default `/api/docs` with
  // the stock theme; consumers override via env or by tweaking
  // `buildScalarConfig` inputs in their own bootstrap shim. The spec
  // URL points at the (future) OpenAPI builder mount.
  if (cfg.env !== 'production' || process.env.SCALAR_PROD === '1') {
    const scalar = buildScalarConfig({ specUrl: '/api/openapi.json' });
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
  }

  return app;
}
