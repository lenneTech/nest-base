import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR, DiscoveryModule, DiscoveryService } from "@nestjs/core";

import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AbilityMiddleware } from "./ability.middleware.js";
import { CanGuard } from "./can.guard.js";
import {
  EXTRA_MEMBER_PER_USER_RESOURCES,
  EXTRA_MEMBER_RESOURCES,
  FEATURE_CONTRIBUTION_PREFIX,
  type MemberResourceContribution,
} from "./extra-resources.token.js";
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
 * Project-extension hook (`EXTRA_MEMBER_RESOURCES` /
 * `EXTRA_MEMBER_PER_USER_RESOURCES`): two shapes compose into the
 * synthesized rules.
 *
 *  1. **Single override** at AppModule level by providing one of the
 *     `EXTRA_*` tokens with `useValue: readonly string[]`.
 *  2. **Per-feature contribution** via `PermissionsModule.forFeature(
 *     { resources, perUserResources })` — multiple modules
 *     contribute, the aggregator (a DiscoveryService scan over
 *     uniquely-keyed Symbols) flat-merges all of them.
 *
 * Both are deduped against the upstream defaults before the planner
 * runs. This keeps `bun run sync:from-template` clean — projects
 * never edit `member-role-rules.ts`.
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

let featureContributionCounter = 0;

/**
 * Aggregate `forFeature` contributions into the canonical
 * `string[][]` shape consumed by `PrismaPermissionStorage`.
 *
 * Walks `DiscoveryService.getProviders()` once per process, picks
 * out providers whose token is a Symbol with a `keyFor` starting
 * with `FEATURE_CONTRIBUTION_PREFIX`, and reads each
 * `MemberResourceContribution`. Results are stable across runs as
 * long as the module imports are deterministic.
 */
function aggregateContributions(
  discovery: DiscoveryService,
  bucket: "resources" | "perUserResources",
): readonly (readonly string[])[] {
  const out: (readonly string[])[] = [];
  for (const wrapper of discovery.getProviders()) {
    const token = wrapper.token;
    if (typeof token !== "symbol") continue;
    const key = Symbol.keyFor(token);
    if (!key || !key.startsWith(FEATURE_CONTRIBUTION_PREFIX)) continue;
    const value = wrapper.instance as MemberResourceContribution | undefined;
    if (!value || typeof value !== "object") continue;
    const list = value[bucket];
    if (Array.isArray(list) && list.length > 0) out.push(list);
  }
  return out;
}

@Module({
  imports: [PrismaModule, DiscoveryModule],
  providers: [
    // Aggregated extras tokens: each is a `string[][]`, one inner
    // array per `forFeature` contribution (or empty when no project
    // module contributes). Projects can also override these with a
    // useValue at AppModule level for a single-source-of-truth
    // catalog — that overrides last-wins, which is exactly what we
    // want for the override path.
    {
      provide: EXTRA_MEMBER_RESOURCES,
      useFactory: (discovery: DiscoveryService): readonly (readonly string[])[] =>
        aggregateContributions(discovery, "resources"),
      inject: [DiscoveryService],
    },
    {
      provide: EXTRA_MEMBER_PER_USER_RESOURCES,
      useFactory: (discovery: DiscoveryService): readonly (readonly string[])[] =>
        aggregateContributions(discovery, "perUserResources"),
      inject: [DiscoveryService],
    },
    {
      provide: PERMISSION_STORAGE,
      useFactory: (
        prisma: PrismaService,
        extraTenant: readonly (readonly string[])[],
        extraUser: readonly (readonly string[])[],
      ): PermissionStorage =>
        new PrismaPermissionStorage(
          prisma,
          {},
          { extraTenantResources: extraTenant, extraUserResources: extraUser },
        ),
      inject: [PrismaService, EXTRA_MEMBER_RESOURCES, EXTRA_MEMBER_PER_USER_RESOURCES],
    },
    PermissionService,
    PermissionInterceptor,
    AbilityMiddleware,
    TestAbilityMiddleware,
    CanGuard,
    { provide: APP_INTERCEPTOR, useClass: PermissionInterceptor },
    { provide: APP_GUARD, useClass: CanGuard },
  ],
  exports: [
    PermissionService,
    PERMISSION_STORAGE,
    EXTRA_MEMBER_RESOURCES,
    EXTRA_MEMBER_PER_USER_RESOURCES,
  ],
})
export class PermissionsModule implements NestModule {
  /**
   * Register a module-level extra-resources contribution. Multiple
   * calls compose: every contribution surfaces in the synthesized
   * Member role rules. Use from a feature module that ships its own
   * `@Can()` subjects:
   *
   * ```ts
   * @Module({
   *   imports: [PermissionsModule.forFeature({ resources: ["Todo"] })],
   * })
   * export class TodoModule {}
   * ```
   *
   * The contribution is registered as a uniquely-keyed Symbol
   * provider so two modules registering the same call site don't
   * collide. Aggregation happens via `DiscoveryService` at storage-
   * factory time — no static module state, no init-order
   * dependency.
   */
  static forFeature(contribution: MemberResourceContribution): DynamicModule {
    // Unique token per call so two modules don't shadow each other.
    // `Symbol.for` so DiscoveryService can read it via Symbol.keyFor.
    const token = Symbol.for(`${FEATURE_CONTRIBUTION_PREFIX}${++featureContributionCounter}`);
    return {
      module: PermissionsModule,
      providers: [{ provide: token, useValue: contribution }],
      exports: [token],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // TestAbility runs first across the whole pipeline — it short-
    // circuits the resolver when a `X-Test-Ability` header is set.
    // The production `AbilityMiddleware` is intentionally registered
    // from `AppModule.configure()` so its position relative to the
    // session middleware (which sets `req.user`) is explicit.
    consumer.apply(TestAbilityMiddleware).forRoutes("*");
  }
}
