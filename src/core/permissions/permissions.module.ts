import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";

import { CanGuard } from "./can.guard.js";
import { PermissionInterceptor } from "./permission.interceptor.js";
import { PermissionService, type PermissionStorage } from "./permission.service.js";
import { PERMISSION_STORAGE } from "./permission-storage.token.js";
import { TestAbilityMiddleware } from "./test-ability.middleware.js";

/**
 * PermissionsModule — wires PermissionService + interceptor + guard.
 *
 * Storage adapter: starts as a no-op stub that returns no rules. The
 * Prisma-backed adapter (which queries `Permission` + `RolePolicy`
 * + `Role` + `Policy` tables) lands in a follow-up slice. With the
 * stub, the system has a working `Ability` instance per request
 * (currently always empty) — controllers using `@Can()` will deny by
 * default until real rules land.
 *
 * Test-ability hatch: `TestAbilityMiddleware` runs BEFORE guards (and
 * thus before `CanGuard`) so e2e specs can pre-seed `req.ability` via
 * the `X-Test-Ability` header. Strict no-op outside `NODE_ENV=test`
 * — the planner refuses any non-test env.
 */
@Module({
  providers: [
    {
      provide: PERMISSION_STORAGE,
      useValue: {
        async findRulesForUser(): Promise<[]> {
          return [];
        },
      } satisfies PermissionStorage,
    },
    PermissionService,
    PermissionInterceptor,
    TestAbilityMiddleware,
    CanGuard,
    { provide: APP_INTERCEPTOR, useClass: PermissionInterceptor },
    { provide: APP_GUARD, useClass: CanGuard },
  ],
  exports: [PermissionService, PERMISSION_STORAGE],
})
export class PermissionsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TestAbilityMiddleware).forRoutes("*");
  }
}
