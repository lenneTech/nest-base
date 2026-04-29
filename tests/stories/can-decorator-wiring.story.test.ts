import { describe, expect, it } from "vitest";

import { AssetController } from "../../src/core/files/asset.controller.js";
import { AddressController } from "../../src/core/geo/address.controller.js";
import { GeoController } from "../../src/core/geo/geo.controller.js";
import { PowerSyncController } from "../../src/core/auth/powersync.controller.js";
import { SearchController } from "../../src/core/search/search.controller.js";
import { CAN_METADATA_KEY } from "../../src/core/permissions/can.guard.js";

/**
 * Story · @Can() decorator wiring across core controllers.
 *
 * `/dev/routes` flagged user-data-touching endpoints (gdpr, address,
 * search, powersync, asset, geo) as `unguarded` because they had no
 * @Can() metadata. They DO check `req.user` for authentication, but
 * they bypass the unified CASL ability layer + output-pipeline +
 * permission tester.
 *
 * Each handler now declares its (action, subject). Existing e2e
 * tests that previously posted unauthenticated now use the test-
 * ability helper (X-Test-Ability header) to seed an admin ability —
 * see `permissions/test-ability.ts`.
 */
describe("Story · @Can() decorator wiring (audit gate)", () => {
  function getCan(target: object, methodName: string): unknown {
    const fn = (target as Record<string, unknown>)[methodName];
    if (typeof fn !== "function") return undefined;
    return Reflect.getMetadata(CAN_METADATA_KEY, fn);
  }

  describe("AddressController", () => {
    it("GET /addresses (list) carries @Can('read', 'Address')", () => {
      expect(getCan(AddressController.prototype, "list")).toEqual({
        action: "read",
        subject: "Address",
      });
    });

    it("POST /addresses (create) carries @Can('create', 'Address')", () => {
      expect(getCan(AddressController.prototype, "create")).toEqual({
        action: "create",
        subject: "Address",
      });
    });

    it("GET /addresses/:id (get) carries @Can('read', 'Address')", () => {
      expect(getCan(AddressController.prototype, "get")).toEqual({
        action: "read",
        subject: "Address",
      });
    });

    it("DELETE /addresses/:id (remove) carries @Can('delete', 'Address')", () => {
      expect(getCan(AddressController.prototype, "remove")).toEqual({
        action: "delete",
        subject: "Address",
      });
    });
  });

  describe("SearchController", () => {
    it("GET /search carries @Can('read', 'Search')", () => {
      expect(getCan(SearchController.prototype, "search")).toEqual({
        action: "read",
        subject: "Search",
      });
    });
  });

  describe("PowerSyncController", () => {
    it("POST /powersync/crud carries @Can('write', 'PowerSync')", () => {
      expect(getCan(PowerSyncController.prototype, "crud")).toEqual({
        action: "write",
        subject: "PowerSync",
      });
    });
  });

  describe("AssetController", () => {
    it("GET /assets/:key carries @Can('read', 'Asset')", () => {
      expect(getCan(AssetController.prototype, "get")).toEqual({
        action: "read",
        subject: "Asset",
      });
    });
  });

  describe("GeoController", () => {
    it("GET /geo/geocode carries @Can('read', 'Geo')", () => {
      expect(getCan(GeoController.prototype, "geocode")).toEqual({
        action: "read",
        subject: "Geo",
      });
    });

    it("GET /geo/reverse-geocode carries @Can('read', 'Geo')", () => {
      expect(getCan(GeoController.prototype, "reverseGeocode")).toEqual({
        action: "read",
        subject: "Geo",
      });
    });

    it("POST /places/nearby carries @Can('read', 'Geo')", () => {
      expect(getCan(GeoController.prototype, "placesNearby")).toEqual({
        action: "read",
        subject: "Geo",
      });
    });
  });
});
