import type { Ability } from "./casl-ability.js";

/**
 * Optional extension point for the `AbilityMiddleware`.
 *
 * ─── The problem this solves ────────────────────────────────────────
 * `AbilityMiddleware` installs an EMPTY ability whenever an
 * authenticated request cannot be resolved to a tenant (no
 * `session.activeOrganizationId`, not a hub-operator path). That is the
 * correct default for the framework: a `@Can()`-gated route then denies
 * via `CanGuard`, and non-`@Can()` routes are unaffected.
 *
 * But a project that runs SINGLE-TENANT (Better-Auth organization plugin
 * off) has NO `activeOrganizationId` on any session — so EVERY
 * authenticated request would fall into the empty-ability branch and a
 * `@Can()` gate would deny every real session. The friction-log calls
 * this the "single-tenant gap": product routes had to stay `@Public()`
 * because `@Can()` was structurally impossible.
 *
 * ─── The hook ───────────────────────────────────────────────────────
 * When a project provides `AUTHENTICATED_ABILITY_FALLBACK`, the
 * middleware consults it at exactly the moment it would otherwise
 * install an empty ability for an AUTHENTICATED user. The provider
 * decides the ability for that session — e.g. resolve the caller's
 * first membership to a tenant and return their role ability, or return
 * a fixed baseline for membership-less app sessions.
 *
 * Contract:
 *   - Returning an `Ability` replaces the empty ability for this
 *     request.
 *   - Returning `null` keeps the framework default (empty ability), so
 *     the provider can opt out per-request (e.g. only act in
 *     single-tenant mode, leaving multi-tenant behaviour byte-identical).
 *   - The hook is NEVER consulted for anonymous requests (no
 *     `req.user`), for requests that already carry an ability
 *     (`X-Test-Ability` / a resolved tenant), or when the tenant
 *     resolver threw a security signal (bad tenant header). It only
 *     ever UPGRADES an empty ability — it can never widen an ability the
 *     framework already resolved.
 *
 * When no project registers the token the middleware behaves exactly as
 * before (the injection is `@Optional()`), so this is a zero-cost,
 * backwards-compatible extension point.
 */
export interface AuthenticatedAbilityFallbackUser {
  /** Authenticated caller id (`req.user.id`). */
  id: string;
  /** API-key scopes when the request authenticated via a scoped key. */
  scopes?: readonly string[];
  /** Active organization from the Better-Auth session, if any. */
  activeOrganizationId?: string | null;
}

export interface AuthenticatedAbilityFallbackInput {
  user: AuthenticatedAbilityFallbackUser;
  /** Resolved request path (`req.originalUrl ?? req.url`), when known. */
  path?: string;
}

export interface AuthenticatedAbilityFallback {
  /**
   * Resolve the ability for an authenticated session the framework
   * could not tenant-scope. Return `null` to keep the empty-ability
   * default.
   */
  resolve(input: AuthenticatedAbilityFallbackInput): Promise<Ability | null>;
}

/** DI token for the optional `AuthenticatedAbilityFallback` provider. */
export const AUTHENTICATED_ABILITY_FALLBACK = Symbol.for("lt:authenticated-ability-fallback");
