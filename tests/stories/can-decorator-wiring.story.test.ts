import { describe, expect, it } from "vitest";

import { AddressController } from "../../src/core/geo/address.controller.js";
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
 * This story locks the wiring in for the controllers that have been
 * migrated. The remaining ones (search, powersync, asset, geo) are
 * tracked as TODO(perm-gate) because their existing e2e suite posts
 * unauthenticated — adding the decorator there would break tests
 * until a test-ability helper is built. See OPEN_QUESTIONS.md.
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
});
