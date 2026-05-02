import { SetMetadata } from "@nestjs/common";

/**
 * `@Public()` — explicit consent that an HTTP handler does not need
 * permission gating.
 *
 * Use sparingly. The default for every controller route is `@Can(action,
 * subject)`; the only acceptable alternatives are `@Public()` (with a
 * comment / reason explaining why) or having the path on the auth-
 * middleware / tenant-guard public allowlist (e.g. `/health/*`,
 * `/api/auth/*`, `/me/*`, `/dev/*`). Anything else is a bug — see
 * Issue #47 for the audit + CI gate.
 *
 * The decorator only sets metadata (`is_public_route: true`) — runtime
 * gating remains enforced by the existing middleware + `CanGuard`.
 * Future Issue #47 introduces a build-time check that asserts every
 * controller method is either `@Can()`, `@Public()`, or path-allowlisted.
 *
 * The required `reason` argument is the consent forced at the
 * decoration site. An agent or human writing `@Public()` MUST explain
 * why ("health probe for k8s", "public OAS catalogue for SDK consumers",
 * etc.). The audit gate will surface these reasons in its report.
 */

export const PUBLIC_ROUTE_METADATA_KEY = "is_public_route";

export interface PublicRouteMetadata {
  isPublic: true;
  reason: string;
}

export const Public = (reason: string): MethodDecorator & ClassDecorator => {
  if (!reason || reason.trim().length === 0) {
    throw new Error("@Public() requires a non-empty reason string");
  }
  return SetMetadata(PUBLIC_ROUTE_METADATA_KEY, {
    isPublic: true,
    reason,
  } satisfies PublicRouteMetadata);
};

/**
 * Type-guard that recognises the `@Public()` metadata shape. Used by
 * the future audit / CI gate (Issue #47) to assert that every
 * controller handler is either `@Can()`-gated or carries explicit
 * `@Public()` consent. Stays defensive — only the literal boolean
 * `true` qualifies, so a stray JSON-roundtripped value cannot pose as
 * consent.
 */
export function isPublicRoute(metadata: unknown): metadata is PublicRouteMetadata {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as { isPublic?: unknown }).isPublic === true
  );
}
