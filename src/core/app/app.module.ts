import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { ConfigModule } from '../config/config.module.js';
import { EncryptionModule } from '../encryption/encryption.module.js';
import { conditionalImport, loadFeatures } from '../features/features.js';
import { HealthModule } from '../health/health.module.js';
import { OutputPipelineInterceptor } from '../output-pipeline/output-pipeline.interceptor.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RequestContextMiddleware } from '../request-context/request-context.middleware.js';
import { AppController } from './app.controller.js';

const features = loadFeatures(process.env as Record<string, string | undefined>);

/**
 * Root module of the NestJS application.
 *
 * Subsequent slices register their feature modules here (Auth, Permissions,
 * Files, Realtime, …) — all behind feature flags so consumers only pull
 * in what they enabled in `features.ts`.
 *
 * `RequestContextMiddleware` runs first on every route so the
 * AsyncLocalStorage context (request id, trace id, tenant) is populated
 * before any controller, guard, or interceptor executes.
 *
 * `OutputPipelineInterceptor` runs on every controller response and
 * strips known-secret-shaped fields (Stages 3+4 of the four-stage
 * Output-Pipeline). The remaining stages (record-level permission
 * filter + field allowlist) activate once an `Ability` is resolvable
 * per request.
 */
@Module({
  imports: [
    ConfigModule.forRoot(),
    PrismaModule,
    HealthModule,
    ...conditionalImport(features, 'fieldEncryption', EncryptionModule.forRoot()),
  ],
  controllers: [AppController],
  providers: [
    RequestContextMiddleware,
    { provide: APP_INTERCEPTOR, useClass: OutputPipelineInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
