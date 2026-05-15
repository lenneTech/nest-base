import { describe, expect, it } from "vitest";

import {
  BaseRepository,
  type ModelDelegate,
  RepositoryNotFoundError,
} from "../../src/core/repository/base.repository.js";

/**
 * Story · Repository-Pattern
 *
 * Services do not call `prisma.<model>.findMany()` directly. They go
 * through a thin Repository layer that:
 *   - centralizes Soft-Delete + Tenant-Scope filters
 *   - is mockable in tests (just supply an in-memory ModelDelegate)
 *   - keeps cross-module coupling at the Service interface, not at
 *     the Prisma model boundary
 *
 * The BaseRepository wraps a Prisma-shaped `ModelDelegate<T>` and
 * provides typed `findById / list / create / update / delete`. Resources
 * subclass it and add their own custom queries.
 */
interface User {
  id: string;
  email: string;
  tenantId: string;
  deletedAt: Date | null;
}

/** Simulate Prisma's P2025 "Record not found" error shape (duck-typed). */
function makePrismaP2025(message = "Record to update not found"): Error {
  return Object.assign(new Error(message), { code: "P2025" });
}

function makeDelegate(): ModelDelegate<User> & { rows: User[] } {
  const rows: User[] = [];
  return {
    get rows() {
      return rows;
    },
    async findUnique(args) {
      return rows.find((r) => r.id === args.where.id) ?? null;
    },
    async findMany(args) {
      let result = rows.slice();
      if (args?.where) {
        for (const [key, value] of Object.entries(args.where)) {
          result = result.filter((r) => (r as unknown as Record<string, unknown>)[key] === value);
        }
      }
      return result;
    },
    async create(args) {
      rows.push(args.data);
      return args.data;
    },
    async update(args) {
      const idx = rows.findIndex((r) => r.id === args.where.id);
      // Throw P2025 so BaseRepository wraps it as RepositoryNotFoundError
      if (idx < 0) throw makePrismaP2025();
      rows[idx] = { ...rows[idx]!, ...args.data };
      return rows[idx]!;
    },
    async delete(args) {
      const idx = rows.findIndex((r) => r.id === args.where.id);
      if (idx < 0) throw makePrismaP2025();
      const [removed] = rows.splice(idx, 1);
      return removed!;
    },
  };
}

class UserRepository extends BaseRepository<User> {
  constructor(delegate: ModelDelegate<User>) {
    super(delegate);
  }
}

describe("Story · BaseRepository", () => {
  describe("findById()", () => {
    it("returns the row when present", async () => {
      const delegate = makeDelegate();
      delegate.rows.push({ id: "1", email: "a@x.com", tenantId: "t1", deletedAt: null });
      const repo = new UserRepository(delegate);
      const user = await repo.findById("1");
      expect(user?.email).toBe("a@x.com");
    });

    it("returns null when missing", async () => {
      const repo = new UserRepository(makeDelegate());
      expect(await repo.findById("missing")).toBeNull();
    });

    it("filters out soft-deleted rows by default", async () => {
      const delegate = makeDelegate();
      delegate.rows.push({ id: "1", email: "a@x.com", tenantId: "t1", deletedAt: new Date() });
      const repo = new UserRepository(delegate);
      expect(await repo.findById("1")).toBeNull();
    });

    it("returns soft-deleted rows when includeDeleted=true", async () => {
      const delegate = makeDelegate();
      delegate.rows.push({ id: "1", email: "a@x.com", tenantId: "t1", deletedAt: new Date() });
      const repo = new UserRepository(delegate);
      expect(await repo.findById("1", { includeDeleted: true })).not.toBeNull();
    });
  });

  describe("list() / count()", () => {
    it("list() returns all rows by default", async () => {
      const delegate = makeDelegate();
      delegate.rows.push(
        { id: "1", email: "a@x.com", tenantId: "t1", deletedAt: null },
        { id: "2", email: "b@x.com", tenantId: "t1", deletedAt: null },
      );
      const repo = new UserRepository(delegate);
      const list = await repo.list();
      expect(list.map((u) => u.id)).toEqual(["1", "2"]);
    });

    it("list() filters soft-deleted by default", async () => {
      const delegate = makeDelegate();
      delegate.rows.push(
        { id: "1", email: "a@x.com", tenantId: "t1", deletedAt: null },
        { id: "2", email: "b@x.com", tenantId: "t1", deletedAt: new Date() },
      );
      const repo = new UserRepository(delegate);
      const list = await repo.list();
      expect(list.map((u) => u.id)).toEqual(["1"]);
    });
  });

  describe("create() / update() / delete()", () => {
    it("create() inserts and returns the new row", async () => {
      const delegate = makeDelegate();
      const repo = new UserRepository(delegate);
      const created = await repo.create({
        id: "1",
        email: "a@x.com",
        tenantId: "t1",
        deletedAt: null,
      });
      expect(created.id).toBe("1");
      expect(delegate.rows).toHaveLength(1);
    });

    it("update() returns the updated row", async () => {
      const delegate = makeDelegate();
      delegate.rows.push({ id: "1", email: "a@x.com", tenantId: "t1", deletedAt: null });
      const repo = new UserRepository(delegate);
      const updated = await repo.update("1", { email: "b@x.com" });
      expect(updated.email).toBe("b@x.com");
    });

    it("update() throws RepositoryNotFoundError on a missing id", async () => {
      const repo = new UserRepository(makeDelegate());
      await expect(repo.update("missing", { email: "b@x.com" })).rejects.toThrow(
        RepositoryNotFoundError,
      );
    });

    it("softDelete() stamps deletedAt instead of physically removing", async () => {
      const delegate = makeDelegate();
      delegate.rows.push({ id: "1", email: "a@x.com", tenantId: "t1", deletedAt: null });
      const repo = new UserRepository(delegate);
      await repo.softDelete("1");
      expect(delegate.rows).toHaveLength(1);
      expect(delegate.rows[0]!.deletedAt).toBeInstanceOf(Date);
    });

    it("hardDelete() removes the row physically", async () => {
      const delegate = makeDelegate();
      delegate.rows.push({ id: "1", email: "a@x.com", tenantId: "t1", deletedAt: null });
      const repo = new UserRepository(delegate);
      await repo.hardDelete("1");
      expect(delegate.rows).toHaveLength(0);
    });

    it("update() re-throws non-P2025 errors without wrapping as RepositoryNotFoundError", async () => {
      // MAJ-4 fix: before the fix, ANY error from the delegate would be
      // re-thrown as RepositoryNotFoundError (including DB-down / constraint
      // violations). Now only P2025 is wrapped.
      const networkError = new Error("Connection refused");
      const brokenDelegate: ModelDelegate<User> = {
        async findUnique() {
          return null;
        },
        async findMany() {
          return [];
        },
        async create(args) {
          return args.data;
        },
        async update() {
          throw networkError;
        },
        async delete() {
          throw networkError;
        },
      };
      const repo = new UserRepository(brokenDelegate);
      // The original error propagates unchanged — NOT wrapped as RepositoryNotFoundError.
      await expect(repo.update("1", { email: "b@x.com" })).rejects.toThrow("Connection refused");
      await expect(repo.update("1", { email: "b@x.com" })).rejects.not.toThrow(
        RepositoryNotFoundError,
      );
    });

    it("update() wraps P2025 as RepositoryNotFoundError", async () => {
      // The P2025 Prisma error shape is duck-typed (no Prisma runtime import).
      const p2025Error = Object.assign(new Error("Record not found"), { code: "P2025" });
      const p2025Delegate: ModelDelegate<User> = {
        async findUnique() {
          return null;
        },
        async findMany() {
          return [];
        },
        async create(args) {
          return args.data;
        },
        async update() {
          throw p2025Error;
        },
        async delete() {
          throw p2025Error;
        },
      };
      const repo = new UserRepository(p2025Delegate);
      await expect(repo.update("missing", { email: "b@x.com" })).rejects.toThrow(
        RepositoryNotFoundError,
      );
      await expect(repo.hardDelete("missing")).rejects.toThrow(RepositoryNotFoundError);
    });
  });
});
