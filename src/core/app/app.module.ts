import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { HealthModule } from '../health/health.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RequestContextMiddleware } from '../request-context/request-context.middleware.js';
import { AppController } from './app.controller.js';

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
 */
@Module({
  imports: [ConfigModule.forRoot(), PrismaModule, HealthModule],
  controllers: [AppController],
  providers: [RequestContextMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
