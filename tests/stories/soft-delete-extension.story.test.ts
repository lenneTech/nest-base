import { describe, expect, it } from "vitest";

import {
  addSoftDeleteFilter,
  convertDeleteToSoftDelete,
  convertRestoreToUpdate,
  isHardDeleteRequest,
  type FindArgs,
} from "../../src/core/repository/soft-delete-extension.js";

/**
 * Story · Soft-Delete Prisma-Extension.
 *
 * The Prisma extension layer auto-applies a `deletedAt: null` filter
 * to every read against soft-delete-enabled models so direct
 * `prisma.<model>.findMany()` callers don't see tombstones. Calls to
 * `delete()` are rewritten to `update({ deletedAt: now })` unless the
 * caller explicitly requested HARD_DELETE; `RESTORE` is the inverse
 * (sets `deletedAt: null`).
 *
 * The pure helpers are tested here; the actual Prisma extension
 * binding is a thin wrapper that delegates to these and lives next
 * to PrismaService.
 */
describe("Story · Soft-Delete extension", () => {
  describe("addSoftDeleteFilter()", () => {
    it("adds deletedAt: null when no where is present", () => {
      const args = addSoftDeleteFilter({}, { includeDeleted: false });
      expect(args.where).toEqual({ deletedAt: null });
    });

    it("AND-merges with an existing where", () => {
      const args = addSoftDeleteFilter({ where: { tenantId: "t1" } }, { includeDeleted: false });
      expect(args.where).toEqual({ AND: [{ tenantId: "t1" }, { deletedAt: null }] });
    });

    it("returns args unchanged when includeDeleted=true", () => {
      const args = addSoftDeleteFilter({ where: { tenantId: "t1" } } as FindArgs, {
        includeDeleted: true,
      });
      expect(args.where).toEqual({ tenantId: "t1" });
    });

    it("does not mutate the input args", () => {
      const original: FindArgs = { where: { tenantId: "t1" } };
      addSoftDeleteFilter(original, { includeDeleted: false });
      expect(original.where).toEqual({ tenantId: "t1" });
    });
  });

  describe("convertDeleteToSoftDelete()", () => {
    it("rewrites a delete to an update that stamps deletedAt", () => {
      const out = convertDeleteToSoftDelete(
        { where: { id: "u1" } },
        new Date("2026-04-28T18:00:00Z"),
      );
      expect(out).toEqual({
        where: { id: "u1" },
        data: { deletedAt: new Date("2026-04-28T18:00:00Z") },
      });
    });
  });

  describe("convertRestoreToUpdate()", () => {
    it("rewrites a restore to an update that clears deletedAt", () => {
      const out = convertRestoreToUpdate({ where: { id: "u1" } });
      expect(out).toEqual({ where: { id: "u1" }, data: { deletedAt: null } });
    });
  });

  describe("isHardDeleteRequest()", () => {
    it("returns true when args carry the HARD_DELETE marker", () => {
      expect(isHardDeleteRequest({ where: { id: "u1" }, hardDelete: true })).toBe(true);
    });

    it("returns false on a plain delete", () => {
      expect(isHardDeleteRequest({ where: { id: "u1" } })).toBe(false);
    });
  });
});
