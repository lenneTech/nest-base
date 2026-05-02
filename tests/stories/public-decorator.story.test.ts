import { describe, expect, it } from "vitest";

import {
  PUBLIC_ROUTE_METADATA_KEY,
  Public,
  isPublicRoute,
  type PublicRouteMetadata,
} from "../../src/core/permissions/public.decorator.js";

/**
 * Story · `@Public()` decorator (route-gating guardrail, prep for #47).
 *
 * The decorator is metadata-only — it does NOT change runtime gating.
 * The existing path-based public allowlists (`jwt-middleware.ts`,
 * `tenant-guard.ts`) keep their behaviour. `@Public()` is the explicit
 * consent token an audit / CI gate (Issue #47) will read.
 *
 * Two invariants this story pins:
 *   1. The metadata shape is stable (`{ isPublic: true, reason }`) and
 *      keyed under `PUBLIC_ROUTE_METADATA_KEY` so future tooling can
 *      Reflect.getMetadata() it without re-importing the decorator.
 *   2. `reason` is required and non-empty — that's the consent forced
 *      at the decoration site. An agent that writes `@Public()` has to
 *      explain why.
 */
describe("Story · @Public() decorator (route-gating guardrail)", () => {
  it("exports a stable metadata key", () => {
    // Stable string key — future Reflect.getMetadata() callers (CI
    // gate in #47) MUST be able to depend on this without importing
    // the decorator at runtime.
    expect(PUBLIC_ROUTE_METADATA_KEY).toBe("is_public_route");
  });

  it("attaches { isPublic: true, reason } metadata when applied to a method", () => {
    class Controller {
      @Public("health probe for k8s")
      health(): string {
        return "ok";
      }
    }

    const meta = Reflect.getMetadata(
      PUBLIC_ROUTE_METADATA_KEY,
      Controller.prototype.health,
    ) as PublicRouteMetadata;
    expect(meta).toEqual({ isPublic: true, reason: "health probe for k8s" });
  });

  it("attaches metadata when applied to a class (controller-level)", () => {
    @Public("public OAS catalogue for SDK consumers")
    class Controller {}

    const meta = Reflect.getMetadata(PUBLIC_ROUTE_METADATA_KEY, Controller) as PublicRouteMetadata;
    expect(meta).toEqual({ isPublic: true, reason: "public OAS catalogue for SDK consumers" });
  });

  it("throws when the reason is an empty string", () => {
    expect(() => Public("")).toThrow(/reason/);
  });

  it("throws when the reason is whitespace-only", () => {
    expect(() => Public("   ")).toThrow(/reason/);
  });

  describe("isPublicRoute()", () => {
    it("returns true for the canonical metadata shape", () => {
      expect(isPublicRoute({ isPublic: true, reason: "x" })).toBe(true);
    });

    it("returns false for undefined / null", () => {
      expect(isPublicRoute(undefined)).toBe(false);
      expect(isPublicRoute(null)).toBe(false);
    });

    it("returns false for objects without isPublic === true", () => {
      expect(isPublicRoute({})).toBe(false);
      expect(isPublicRoute({ isPublic: false, reason: "x" })).toBe(false);
      // String "true" is not the literal boolean — guard rejects it so
      // a stray JSON-roundtripped value cannot pose as consent.
      expect(isPublicRoute({ isPublic: "true", reason: "x" })).toBe(false);
    });

    it("returns false for primitives", () => {
      expect(isPublicRoute("public")).toBe(false);
      expect(isPublicRoute(42)).toBe(false);
      expect(isPublicRoute(true)).toBe(false);
    });
  });
});
