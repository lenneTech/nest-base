/**
 * DI tokens that let project modules extend the synthesized "Member"
 * role catalog without editing template-owned code.
 *
 * Why two tokens: the per-tenant rules apply `$CURRENT_TENANT`
 * scoping; the per-user rules apply `$CURRENT_USER` scoping. They are
 * NOT interchangeable — see `member-role-rules.ts` for the rationale
 * and the canonical examples (`Address` is per-tenant, `ApiKey` is
 * per-user).
 *
 * There are two ways to contribute:
 *
 * 1. **Single override at the AppModule level** — useful when the
 *    project owns the full extra-resources list and wants to declare
 *    it once:
 *
 *    ```ts
 *    import { EXTRA_MEMBER_RESOURCES } from "../core/permissions/extra-resources.token.js";
 *
 *    @Module({
 *      providers: [
 *        { provide: EXTRA_MEMBER_RESOURCES, useValue: ["Todo", "Invoice"] },
 *      ],
 *    })
 *    export class AppModule {}
 *    ```
 *
 * 2. **Per-feature contribution via `PermissionsModule.forFeature()`**
 *    — useful when a feature module wants to ship its own resource
 *    grant alongside its `@Can()` routes. Multiple `forFeature` calls
 *    compose: each contribution is collected via `DiscoveryService`
 *    and flat-merged into the synthesized rules.
 *
 *    ```ts
 *    @Module({
 *      imports: [
 *        PermissionsModule.forFeature({ resources: ["Todo"] }),
 *      ],
 *    })
 *    export class TodoModule {}
 *    ```
 *
 * Both shapes are deduped before passing into the rule planner so a
 * default plus an extra contributing the same name produces a single
 * rule.
 *
 * Why not Angular-style `multi: true` providers: NestJS's DI
 * container does not aggregate `multi: true` registrations of the
 * same token (it last-wins). The two shapes above are the
 * Nest-idiomatic equivalents.
 */
export const EXTRA_MEMBER_RESOURCES = Symbol.for("lt:extra-member-resources");
export const EXTRA_MEMBER_PER_USER_RESOURCES = Symbol.for(
  "lt:extra-member-per-user-resources",
);

/**
 * Internal namespace prefix attached to every `forFeature`
 * contribution. The aggregator scans `DiscoveryService` for tokens
 * whose `Symbol.keyFor(...)` starts with the prefix; each match's
 * `useValue` is one contribution.
 *
 * Exported so tests can poke at it directly without re-deriving the
 * naming convention.
 */
export const FEATURE_CONTRIBUTION_PREFIX = "lt:permissions:feature-contribution:";

/**
 * Shape one `forFeature` registration produces. Stored as the
 * `useValue` of a uniquely-keyed Symbol so the aggregator can pick
 * it up without coordinating registration order.
 */
export interface MemberResourceContribution {
  resources?: readonly string[];
  perUserResources?: readonly string[];
}
