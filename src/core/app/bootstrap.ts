import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { buildSecurityHeadersConfig } from '../http/security-headers.js';
import { serverConfigFromEnv } from '../server/server-config.js';
import { AppModule } from './app.module.js';

export interface BootstrapOptions {
  /** When false, the app is created but `listen()` is skipped (used in tests). */
  listen?: boolean;
}

/**
 * Boot the NestJS application.
 *
 * Tests call this with `{ listen: false }` and use the returned
 * `app.getHttpServer()` directly via supertest. `bun run dev` calls
 * with `{ listen: true }` to bind the configured port.
 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<INestApplication> {
  const { listen = true } = options;

  const cfg = serverConfigFromEnv(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.disable('x-powered-by');

  const security = buildSecurityHeadersConfig(cfg.env);
  app.use(
    helmet({
      contentSecurityPolicy: security.contentSecurityPolicy,
      ...(security.hsts ? { hsts: security.hsts } : { hsts: false }),
    }),
  );

  await app.init();

  if (listen) {
    await app.listen(cfg.port, cfg.host);
  }

  return app;
}
