import { describe, expect, it } from "vitest";

import { buildPowerSyncJwtConfig } from "../../src/core/auth/powersync-jwt.js";
import {
  SINGLE_TENANT_ID,
  resolveEffectivePowerSyncTenantId,
} from "../../src/core/auth/powersync-tenant.js";

/**
 * Story · PowerSync single-tenant mode (no multiTenancy required).
 *
 * PowerSync is tenant-keyed throughout (`PowerSyncRow` PK is
 * `(tenantId, type, id)`), but the `tenantId` column has NO foreign
 * key, so a fixed sentinel UUID is a safe stand-in when the
 * `multiTenancy` feature is off. The `user` sync bucket carries
 * per-user data tenant-lessly (scoped by `request.user_id()`), so
 * single-tenant sync works; the `tenant` bucket harmlessly resolves
 * to the sentinel and returns no rows.
 *
 * This story pins:
 *   - the sentinel constant is a valid, all-zero UUID
 *   - `resolveEffectivePowerSyncTenantId` returns the real tenant when
 *     multiTenancy is on, the sentinel when off
 *   - the JWT planner emits the sentinel claim in single-tenant mode
 *     while staying byte-identical in multi-tenant mode
 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

describe("Story · PowerSync single-tenant mode", () => {
  describe("SINGLE_TENANT_ID sentinel", () => {
    it("is a valid UUID the all-zero PowerSyncRow.tenantId can hold (no FK)", () => {
      expect(SINGLE_TENANT_ID).toMatch(UUID_PATTERN);
      expect(SINGLE_TENANT_ID).toBe("00000000-0000-0000-0000-000000000000");
    });
  });

  describe("resolveEffectivePowerSyncTenantId", () => {
    it("returns the real tenant id when multiTenancy is enabled", () => {
      const id = resolveEffectivePowerSyncTenantId({
        multiTenancyEnabled: true,
        tenantId: "11111111-1111-7111-8111-111111111111",
      });
      expect(id).toBe("11111111-1111-7111-8111-111111111111");
    });

    it("returns the sentinel when multiTenancy is disabled (no real tenant exists)", () => {
      const id = resolveEffectivePowerSyncTenantId({
        multiTenancyEnabled: false,
        tenantId: undefined,
      });
      expect(id).toBe(SINGLE_TENANT_ID);
    });

    it("ignores any incoming tenant id when multiTenancy is disabled", () => {
      // Defense-in-depth: even if a stray tenant id leaks in, single-tenant
      // mode must collapse to the sentinel so the data is never split.
      const id = resolveEffectivePowerSyncTenantId({
        multiTenancyEnabled: false,
        tenantId: "deadbeef-0000-7000-8000-000000000000",
      });
      expect(id).toBe(SINGLE_TENANT_ID);
    });

    it("returns undefined when multiTenancy is on but no tenant is resolved (caller must reject)", () => {
      // Multi-tenant behaviour is unchanged: a missing tenant is an error
      // the controller surfaces as 401, never silently bucketed.
      const id = resolveEffectivePowerSyncTenantId({
        multiTenancyEnabled: true,
        tenantId: undefined,
      });
      expect(id).toBeUndefined();
    });
  });

  describe("buildPowerSyncJwtConfig — single-tenant claim", () => {
    it("emits the sentinel tenantId claim when multiTenancy is disabled", () => {
      const config = buildPowerSyncJwtConfig({
        baseUrl: "https://api.example.com",
        multiTenancyEnabled: false,
      });
      const claims = config.jwt.definePayload({ userId: "u1" });
      expect(claims).toEqual({ sub: "u1", tenantId: SINGLE_TENANT_ID });
    });

    it("is byte-identical in multi-tenant mode (real tenant present)", () => {
      const config = buildPowerSyncJwtConfig({
        baseUrl: "https://api.example.com",
        multiTenancyEnabled: true,
      });
      const claims = config.jwt.definePayload({ userId: "u1", tenantId: "t1" });
      expect(claims).toEqual({ sub: "u1", tenantId: "t1" });
    });

    it("is byte-identical in multi-tenant mode (no tenant → sub only)", () => {
      const config = buildPowerSyncJwtConfig({
        baseUrl: "https://api.example.com",
        multiTenancyEnabled: true,
      });
      const claims = config.jwt.definePayload({ userId: "u1" });
      expect(claims).toEqual({ sub: "u1" });
    });

    it("defaults to multi-tenant behaviour when the flag is omitted (back-compat)", () => {
      // Existing call-sites that don't pass `multiTenancyEnabled` must keep
      // the original `tenantId ? { sub, tenantId } : { sub }` semantics.
      const config = buildPowerSyncJwtConfig({ baseUrl: "https://api.example.com" });
      expect(config.jwt.definePayload({ userId: "u1", tenantId: "t1" })).toEqual({
        sub: "u1",
        tenantId: "t1",
      });
      expect(config.jwt.definePayload({ userId: "u1" })).toEqual({ sub: "u1" });
    });
  });
});
