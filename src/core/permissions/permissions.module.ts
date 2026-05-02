import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";

import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AbilityMiddleware } from "./ability.middleware.js";
import { CanGuard } from "./can.guard.js";
import { PermissionInterceptor } from "./permission.interceptor.js";
import { PermissionService, type PermissionStorage } from "./permission.service.js";
import { PERMISSION_STORAGE } from "./permission-storage.token.js";
import { PrismaPermissionStorage } from "./prisma-permission-storage.js";
import { TestAbilityMiddleware } from "./test-ability.middleware.js";

/**
 * PermissionsModule — wires PermissionService + middleware + guard.
 *
 * Storage adapter: `PrismaPermissionStorage` is the default
 * (closes blocker, replaces the previous no-op stub). It returns
 * the joined `Role → RolePolicy → Policy → Permission` rows for the
 * caller's tenant membership PLUS a synthesized "Member" ruleset
 * scoped via `$CURRENT_TENANT` so every ACTIVE tenant member can
 * exercise project-facing `@Can()` routes without an admin first
 * authoring a policy.
 *
 * Backwards compatibility: projects that already ship their own
 * permission storage can override the `PERMISSION_STORAGE` provider
 * (it's exported as a DI token). Projects that rolled their own
 * Member role can disable the synthesized layer with
 * `new PrismaPermissionStorage(prisma, { synthesizeMemberRules: false })`.
 *
 * Lifecycle:
 *   - `TestAbilityMiddleware` runs first — honours the
 *     `X-Test-Ability` header in `NODE_ENV=test` and pre-seeds the
 *     ability for spec convenience. Strict no-op outside test.
 *   - `AbilityMiddleware` runs next and resolves the ability via
 *     `PermissionService.abilityFor(userId, tenantId)` from
 *     `req.user`. NestJS runs middleware BEFORE guards, so
 *     `CanGuard` always sees a populated `req.ability`.
 *   - `PermissionInterceptor` is kept on the providers map for
 *     downstream consumers that still inject it directly (e.g.
 *     project tests asserting against the interceptor in
 *     isolation). It is no longer registered as `APP_INTERCEPTOR`
 *     since the middleware now owns the attachment path.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: PERMISSION_STORAGE,
      useFactory: (prisma: PrismaService): PermissionStorage => new PrismaPermissionStorage(prisma),
      inject: [PrismaService],
    },
    PermissionService,
    PermissionInterceptor,
    AbilityMiddleware,
    TestAbilityMiddleware,
    CanGuard,
    { provide: APP_INTERCEPTOR, useClass: PermissionInterceptor },
    { provide: APP_GUARD, useClass: CanGuard },
  ],
  exports: [PermissionService, PERMISSION_STORAGE],
})
export class PermissionsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // TestAbility runs first across the whole pipeline — it short-
    // circuits the resolver when a `X-Test-Ability` header is set.
    // The production `AbilityMiddleware` is intentionally registered
    // from `AppModule.configure()` so its position relative to the
    // session middleware (which sets `req.user`) is explicit.
    consumer.apply(TestAbilityMiddleware).forRoutes("*");
  }
}
