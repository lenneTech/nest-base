/**
 * `src/shared/` — barrel for types/contracts that are shared between
 * the server and the kubb-generated SDK.
 *
 * Channel-Constants for Realtime, event-schemas for Webhooks, and
 * cross-cutting branded types live here. Consumers import from
 * `@shared/*`. Nothing in here may depend on `@core/*` or `@modules/*`.
 *
 * Population grows with the realtime/webhook slices; until then this
 * barrel is intentionally empty and exists only to anchor the path
 * alias and the eventual SDK-publish boundary.
 */

export {};
