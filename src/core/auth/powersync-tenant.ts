/**
 * PowerSync tenant resolution — single-tenant support.
 *
 * PowerSync is tenant-keyed throughout: `PowerSyncRow`'s primary key is
 * `(tenantId, type, id)`, the store takes `tenantId` as a required
 * param, and the JWT can carry a `tenantId` claim. When the
 * `multiTenancy` feature is OFF no tenants exist, yet the sync surface
 * still needs *some* tenant key to bucket rows under.
 *
 * `PowerSyncRow.tenantId` is `String @db.Uuid` with NO foreign key to
 * any tenants table, so a fixed sentinel UUID is a safe stand-in that
 * needs no schema migration. Every PowerSync tenant derivation routes
 * through `resolveEffectivePowerSyncTenantId` so the OFF path collapses
 * to the sentinel while the ON path stays byte-identical to the
 * real-tenant behaviour.
 */

/**
 * The single-tenant sentinel. Used as `PowerSyncRow.tenantId` and as the
 * JWT `tenantId` claim whenever `multiTenancy` is disabled. All-zero so
 * it is visibly synthetic in logs and never collides with a real
 * Better-Auth organization id.
 */
export const SINGLE_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export interface EffectivePowerSyncTenantInput {
  /** `features.multiTenancy.enabled`. */
  multiTenancyEnabled: boolean;
  /** The real tenant id resolved from session ALS (only meaningful when multiTenancy is on). */
  tenantId?: string | undefined;
}

/**
 * Resolve the effective PowerSync tenant id.
 *
 *   - multiTenancy ON  → the real `tenantId` (or `undefined` when none
 *     was resolved — the caller MUST reject that, exactly as before).
 *   - multiTenancy OFF → the sentinel, regardless of any incoming
 *     `tenantId` (defense-in-depth: single-tenant data is never split).
 */
export function resolveEffectivePowerSyncTenantId(
  input: EffectivePowerSyncTenantInput,
): string | undefined {
  if (!input.multiTenancyEnabled) {
    return SINGLE_TENANT_ID;
  }
  return input.tenantId;
}
