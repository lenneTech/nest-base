import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { HealthModule } from '../health/health.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppController } from './app.controller.js';

/**
 * Root module of the NestJS application.
 *
 * Subsequent slices register their feature modules here (Auth, Permissions,
 * Files, Realtime, …) — all behind feature flags so Konsumenten only pull
 * in what they enabled in `features.ts`.
 */
@Module({
  imports: [ConfigModule.forRoot(), PrismaModule, HealthModule],
  controllers: [AppController],
})
export class AppModule {}
